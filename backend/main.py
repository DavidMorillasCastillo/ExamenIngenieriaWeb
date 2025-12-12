import os
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from jose import JWTError, jwt
from dotenv import load_dotenv
import pymongo
from bson import ObjectId
import httpx
import cloudinary
import cloudinary.uploader

# GOOGLE LIBS
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

# --- CONFIGURACIÓN ---
load_dotenv(dotenv_path="../.env")

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET")
)

SECRET_KEY = os.getenv("SECRET_KEY", "secret")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = 30
MONGO_URI = os.getenv("MONGO_URI")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

client = pymongo.MongoClient(MONGO_URI)
db = client.get_default_database()

users_collection = db["users"]
reviews_collection = db["reviews"] # Colección principal del examen

app = FastAPI(title="ReViews API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- UTILIDADES ---
def fix_id(doc):
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_coordinates(address: str):
    async with httpx.AsyncClient() as client:
        url = "https://nominatim.openstreetmap.org/search"
        headers = {"User-Agent": "ExamenWeb/1.0"}
        try:
            resp = await client.get(url, params={"q": address, "format": "json", "limit": 1}, headers=headers)
            data = resp.json()
            if data: return float(data[0]["lat"]), float(data[0]["lon"])
        except:
            pass
        return 0.0, 0.0

async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        # Decodificamos el token NUESTRO para saber quien es
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if not email: raise HTTPException(status_code=401)
        # Devolvemos también el token en crudo porque el examen pide guardarlo
        return {"email": email, "raw_token": token, "payload": payload}
    except JWTError: raise HTTPException(status_code=401)

# --- MODELOS ---
class GoogleLoginRequest(BaseModel):
    token: str

class ReviewResponse(BaseModel):
    id: str
    establishment: str
    address: str
    rating: int
    image_url: str
    latitude: float
    longitude: float
    author_email: str
    author_name: str
    token_issued_at: float
    token_expires_at: float
    raw_token: str

# --- ENDPOINTS AUTH (GOOGLE) ---

@app.get("/")
def read_root(): return {"message": "API ReViews Funcionando ⭐"}

@app.post("/google-login")
def google_login(request: GoogleLoginRequest):
    try:
        idinfo = id_token.verify_oauth2_token(request.token, google_requests.Request(), GOOGLE_CLIENT_ID)
        email = idinfo['email']
        name = idinfo.get('name', 'Usuario')
        
        user = users_collection.find_one({"email": email})
        if not user:
            users_collection.insert_one({
                "email": email,
                "name": name,
                "google_id": idinfo['sub'],
                "created_at": datetime.now()
            })
        
        # Guardamos el nombre en el token para usarlo luego
        access_token = create_access_token(data={"sub": email, "name": name})
        return {"access_token": access_token, "token_type": "bearer", "email": email}

    except ValueError:
        raise HTTPException(status_code=401, detail="Token Google inválido")

# --- ENDPOINTS REVIEWS (LÓGICA EXAMEN) ---

@app.get("/reviews", response_model=List[ReviewResponse])
def get_reviews(user: dict = Depends(get_current_user)):
    reviews = list(reviews_collection.find({}))
    return [fix_id(r) for r in reviews]

@app.post("/reviews")
async def create_review(
    establishment: str = Form(...),
    address: str = Form(...),
    rating: int = Form(...),
    file: UploadFile = File(...),
    user_data: dict = Depends(get_current_user)
):
    # 1. Subir imagen (Requisito: Imágenes [cite: 29])
    up_res = cloudinary.uploader.upload(file.file)
    image_url = up_res.get("secure_url")

    # 2. Geocoding (Requisito: Mapas y Geocoding [cite: 33])
    lat, lon = await get_coordinates(address)

    # 3. Extraer datos del token (Requisito: Creación de reseñas [cite: 27, 28])
    # El examen pide guardar el token, fechas y autor tomados del token.
    token_payload = user_data["payload"]
    
    new_review = {
        "establishment": establishment,
        "address": address,
        "rating": rating,
        "image_url": image_url,
        "latitude": lat,
        "longitude": lon,
        # Datos del autor y token
        "author_email": user_data["email"],
        "author_name": token_payload.get("name", "Anónimo"),
        "raw_token": user_data["raw_token"], # Guardamos el token usado
        "token_issued_at": token_payload.get("iat", 0),
        "token_expires_at": token_payload.get("exp", 0)
    }
    
    res = reviews_collection.insert_one(new_review)
    new_review["_id"] = res.inserted_id
    return fix_id(new_review)
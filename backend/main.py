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
items_collection = db["items"] # Colección genérica de ejemplo

app = FastAPI(title="Esqueleto API Google")

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
        headers = {"User-Agent": "EsqueletoWeb/1.0"}
        try:
            resp = await client.get(url, params={"q": address, "format": "json", "limit": 1}, headers=headers)
            data = resp.json()
            if data: return float(data[0]["lat"]), float(data[0]["lon"])
        except:
            pass
        return 0.0, 0.0

async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if not email: raise HTTPException(status_code=401)
    except JWTError: raise HTTPException(status_code=401)
    return {"email": email}

# --- MODELOS ---
class GoogleLoginRequest(BaseModel):
    token: str

class ItemResponse(BaseModel):
    id: str
    title: str
    image_url: str

# --- ENDPOINTS AUTH ---

@app.get("/")
def read_root(): return {"message": "API Esqueleto Funcionando 💀"}

@app.post("/google-login")
def google_login(request: GoogleLoginRequest):
    try:
        # Verificar token con Google
        idinfo = id_token.verify_oauth2_token(request.token, google_requests.Request(), GOOGLE_CLIENT_ID)
        email = idinfo['email']
        
        # Guardar/Actualizar usuario
        user = users_collection.find_one({"email": email})
        if not user:
            users_collection.insert_one({
                "email": email,
                "google_id": idinfo['sub'],
                "created_at": datetime.now()
            })
        
        # Generar nuestro token
        access_token = create_access_token(data={"sub": email})
        return {"access_token": access_token, "token_type": "bearer", "email": email}

    except ValueError:
        raise HTTPException(status_code=401, detail="Token Google inválido")

# --- ENDPOINTS EJEMPLO (CRUD) ---

@app.get("/items", response_model=List[ItemResponse])
def get_items(user: dict = Depends(get_current_user)):
    # Ejemplo: Devolver items del usuario
    items = list(items_collection.find({"owner": user["email"]}))
    return [fix_id(item) for item in items]

@app.post("/items")
async def create_item(title: str = Form(...), file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    # Ejemplo: Subir imagen y guardar
    up_res = cloudinary.uploader.upload(file.file)
    item = {
        "title": title,
        "image_url": up_res.get("secure_url"),
        "owner": user["email"]
    }
    items_collection.insert_one(item)
    return {"message": "Item creado"}
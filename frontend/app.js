const API_URL = "http://localhost:8000"; // IMPORTANTE: CAMBIAR ESTO EL DÍA DEL EXAMEN SI ESTAS EN RENDER
//const API_URL = "https://exameningenieriaweb.onrender.com";
// CAMBIAR URL EN PRODUCCIÓN


const token = localStorage.getItem("token");
const myEmail = localStorage.getItem("username");

if (!token) window.location.href = "login.html";
document.getElementById("userInfo").innerText = `Usuario: ${myEmail}`;

// Inicializar Mapa
const map = L.map('map').setView([40.416, -3.703], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = [];

// --- 1. CARGAR RESEÑAS (LISTA Y MAPA) ---
async function loadReviews() {
    // Limpiar
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    const list = document.getElementById("reviewsList");
    list.innerHTML = "";

    try {
        const res = await fetch(`${API_URL}/reviews`, { headers: { "Authorization": `Bearer ${token}` } });
        if (!res.ok) throw new Error("Error cargando datos");
        const reviews = await res.json();

        reviews.forEach(rev => {
            // A. Añadir a la lista HTML [cite: 14]
            const li = document.createElement("li");
            li.className = "review-item";
            li.innerHTML = `
                <strong>${rev.establishment}</strong> <span class="stars">★ ${rev.rating}</span><br>
                <small>${rev.address}</small>
            `;
            li.onclick = () => showDetails(rev); // Al hacer clic muestra detalles [cite: 20]
            list.appendChild(li);

            // B. Añadir al Mapa [cite: 32]
            if (rev.latitude && rev.longitude) {
                const marker = L.marker([rev.latitude, rev.longitude]).addTo(map);
                // Al hacer clic en marcador también muestra detalles
                marker.on('click', () => {
                    showDetails(rev);
                    // Centrar mapa un poco
                    map.setView([rev.latitude, rev.longitude], 15);
                });
                markers.push(marker);
            }
        });

    } catch (err) {
        console.error(err);
    }
}

// --- 2. MOSTRAR DETALLES (REQUISITO EXAMEN) ---
function showDetails(rev) {
    const panel = document.getElementById("detailsPanel");
    panel.style.display = "block";

    // Rellenar datos básicos
    document.getElementById("detName").innerText = rev.establishment;
    document.getElementById("detAddress").innerText = rev.address;
    document.getElementById("detRating").innerText = "★".repeat(rev.rating) + "☆".repeat(5 - rev.rating);
    document.getElementById("detImage").src = rev.image_url;

    // Rellenar datos técnicos (Token, Autor, Fechas) [cite: 21-24]
    document.getElementById("detAuthor").innerText = `${rev.author_name} (${rev.author_email})`;
    
    // Convertir timestamps a fecha legible
    const issuedDate = new Date(rev.token_issued_at * 1000).toLocaleString();
    const expDate = new Date(rev.token_expires_at * 1000).toLocaleString();
    
    document.getElementById("detIat").innerText = issuedDate;
    document.getElementById("detExp").innerText = expDate;
    document.getElementById("detToken").innerText = rev.raw_token;
}

function closeDetails() {
    document.getElementById("detailsPanel").style.display = "none";
}

// --- 3. CREAR RESEÑA ---
document.getElementById("reviewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("establishment", document.getElementById("revName").value);
    formData.append("address", document.getElementById("revAddress").value);
    formData.append("rating", document.getElementById("revRating").value);
    formData.append("file", document.getElementById("revFile").files[0]);

    const res = await fetch(`${API_URL}/reviews`, { 
        method: "POST", 
        headers: { "Authorization": `Bearer ${token}` }, 
        body: formData 
    });

    if (res.ok) {
        alert("Reseña creada y firmada con tu token!");
        document.getElementById("reviewForm").reset();
        loadReviews(); // Recargar lista
    } else {
        alert("Error creando reseña");
    }
});

// --- 4. BUSCAR EN MAPA (CENTRADO) [cite: 34] ---
async function searchMapLocation() {
    const address = document.getElementById("mapSearchAddress").value;
    if (!address) return;

    try {
        // Usamos la API de Nominatim directamente para obtener coords sin guardar nada
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${address}`);
        const data = await res.json();
        
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            map.setView([lat, lon], 14); // Centrar mapa y zoom
        } else {
            alert("Dirección no encontrada");
        }
    } catch (err) {
        console.error(err);
    }
}

function logout() {
    localStorage.clear();
    window.location.href = "login.html";
}

// Iniciar
loadReviews();

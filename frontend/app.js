// CAMBIAR URL EN PRODUCCIÓN
//const API_URL = "http://localhost:8000"; 
const API_URL = "https://exameningenieriaweb.onrender.com/";

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
            // A. Añadir a la lista HTML
            const li = document.createElement("li");
            li.className = "review-item";
            li.innerHTML = `
                <strong>${rev.establishment}</strong> <span class="stars">★ ${rev.rating}</span><br>
                <small>${rev.address}</small>
            `;
            li.onclick = () => showDetails(rev); // Al hacer clic muestra detalles
            list.appendChild(li);

            // B. Añadir al Mapa
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
    
    // --- NUEVO: Rellenar MÚLTIPLES IMÁGENES ---
    const container = document.getElementById("detImagesContainer");
    container.innerHTML = ""; // Limpiar fotos anteriores
    
    // El backend ahora devuelve 'image_urls' (lista), no 'image_url' (string)
    // Pero por compatibilidad si tienes datos viejos, comprobamos ambos o solo el nuevo si borraste la BD.
    const images = rev.image_urls || (rev.image_url ? [rev.image_url] : []);
    
    if (images.length > 0) {
        images.forEach(url => {
            const img = document.createElement("img");
            img.src = url;
            // Estilos aplicados en CSS, forzamos atributos básicos
            img.alt = "Foto reseña";
            container.appendChild(img);
        });
    } else {
        container.innerHTML = "<p>Sin imágenes</p>";
    }
    // -------------------------------------------

    // Rellenar datos técnicos (Token, Autor, Fechas)
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
    
    // --- CAMBIO PARA MÚLTIPLES ARCHIVOS ---
    const fileInput = document.getElementById("revFiles"); // Ojo al ID plural 'revFiles'
    // Recorremos todos los archivos seleccionados y los añadimos
    for (let i = 0; i < fileInput.files.length; i++) {
        formData.append("files", fileInput.files[i]);
    }
    // --------------------------------------

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

// --- 4. BUSCAR EN MAPA (CENTRADO) ---
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
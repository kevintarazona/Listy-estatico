// --- Constants & Config ---
const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const TILE_LAYER_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// --- State ---
let map = null;
let currentUserLocation = null; // { lat, lng }
let markers = [];
let restaurants = [];

// --- DOM Elements ---
const views = {
    landing: document.getElementById('landing-view'),
    map: document.getElementById('map-view'),
};
const btnStart = document.getElementById('btn-start');
const statusMessage = document.getElementById('status-message');
const placesList = document.getElementById('places-list');
const resultsCount = document.getElementById('results-count');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    btnStart.addEventListener('click', handleStartApp);
});

// --- Core Flows ---

async function handleStartApp() {
    updateStatus('Solicitando ubicación...', 'neutral');

    // Check for Secure Context (HTTPS) - Critical for mobile
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isSecure = window.location.protocol === 'https:' || isLocalhost;

    if (!isSecure) {
        console.warn("Geolocation requires a secure context (HTTPS) on non-localhost origins.");
        // We don't return here, we let it try and fail so we can catch the specific error, 
        // but we'll use this flag to give a better error message.
    }

    try {
        const position = await getGeolocation();
        currentUserLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        switchView('map');
        initMap(currentUserLocation);
        fetchNearbyRestaurants(currentUserLocation);

    } catch (error) {
        console.error("Geolocation error:", error);
        let msg = 'No pudimos obtener tu ubicación. ';

        if (error.code === 1) { // PERMISSION_DENIED
            // Check if we can detect if it's a hard block
            if (navigator.permissions) {
                try {
                    const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
                    if (permissionStatus.state === 'denied') {
                        msg = '⛔ Acceso denegado. Tienes bloqueada la ubicación para este sitio. Toca el candado 🔒 en la barra de dirección > Permisos > restablecer.';
                    } else {
                        msg = 'Por favor permite el acceso a la ubicación cuando el navegador lo solicite.';
                    }
                } catch (e) {
                    msg = 'Por favor permite el acceso. Asegúrate de que tu navegador tenga permiso en el sistema.';
                }
            } else {
                msg = 'Permiso denegado. Revisa la configuración de tu navegador.';
            }
        }
        else if (error.code === 2) msg += 'Posición no disponible. Verifica que el GPS esté activo.';
        else if (error.code === 3) msg += 'Se agotó el tiempo. Intenta de nuevo en un lugar abierto.';
        else msg += error.message || 'Error desconocido.';

        updateStatus(msg, 'error');
    }
}

function switchView(viewName) {
    if (viewName === 'map') {
        views.landing.classList.add('hidden');
        views.map.classList.remove('hidden');
        views.map.classList.add('flex'); // Because it's flexbox

        // Leaflet needs to know container size changed
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 100);
    } else {
        views.landing.classList.remove('hidden');
        views.map.classList.add('hidden');
        views.map.classList.remove('flex');
    }
}

// --- Geolocation ---
function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation not supported"));
        } else {
            // Using enableHighAccuracy: false is faster and more reliable on mobile web
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 20000,
                maximumAge: 30000 // Accept cached positions up to 30s old
            });
        }
    });
}

function updateStatus(text, type) {
    statusMessage.textContent = text;
    if (type === 'error') statusMessage.classList.add('text-red-500');
    else statusMessage.classList.remove('text-red-500');
}

// --- Map Logic ---
function initMap(location) {
    if (map) return; // Already init

    // Create Map
    map = L.map('map', {
        center: [location.lat, location.lng],
        zoom: 15,
        zoomControl: false // We can add custom control or styles
    });

    // Add Tile Layer (Dark Mode)
    L.tileLayer(TILE_LAYER_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 20
    }).addTo(map);

    // Add User Marker (Pulse Effect)
    const userIcon = L.divIcon({
        className: 'bg-transparent',
        html: `<div class="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg relative">
                 <div class="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-75"></div>
               </div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    L.marker([location.lat, location.lng], { icon: userIcon }).addTo(map)
        .bindPopup("Estás aquí")
        .openPopup();

    // Zoom control with custom style is handled by CSS targeting leaflet classes, 
    // but let's add it consistently bottom-right
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);
}

function createRestaurantMarker(place) {
    const lat = place.lat;
    const lng = place.lon;

    // Custom Marker Icon based on type
    let iconClass = 'fa-utensils';
    let color = 'text-orange-500';

    if (place.tags.amenity === 'cafe') { iconClass = 'fa-mug-hot'; color = 'text-emerald-400'; }
    else if (place.tags.amenity === 'bar' || place.tags.amenity === 'pub') { iconClass = 'fa-wine-glass'; color = 'text-purple-400'; }
    else if (place.tags.amenity === 'fast_food') { iconClass = 'fa-burger'; color = 'text-yellow-400'; }

    // HTML Icon for Leaflet
    const customIcon = L.divIcon({
        className: 'bg-transparent',
        html: `<div class="w-8 h-8 bg-slate-800 rounded-full border border-slate-600 flex items-center justify-center shadow-lg transform hover:scale-110 transition-transform">
                 <i class="fa-solid ${iconClass} ${color} text-sm"></i>
               </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });

    const marker = L.marker([lat, lng], { icon: customIcon });

    const popupContent = `
        <div class="min-w-[150px]">
            <h3 class="font-bold text-base mb-1 text-white">${place.tags.name || 'Sin nombre'}</h3>
            <p class="text-slate-400 text-xs mb-2">${place.tags['addr:street'] || ''} ${place.tags['addr:housenumber'] || ''}</p>
            <span class="inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-700 text-slate-300">
                ${place.tags.cuisine || place.tags.amenity}
            </span>
        </div>
    `;

    marker.bindPopup(popupContent);
    marker.on('click', () => {
        highlightCard(place.id);
    });

    return marker;
}

// --- Data Fetching ---
async function fetchNearbyRestaurants(location) {
    updatePlacesListState('loading');

    // CACHE CHECK
    const cached = sessionStorage.getItem('listy_cache');
    if (cached) {
        const { lat, lng, data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        const dist = getDistanceFromLatLonInKm(lat, lng, location.lat, location.lng);

        // Cache valid for 10 minutes and if user moved less than 100 meters
        if (age < 1000 * 60 * 10 && dist < 0.1) {
            console.log("Using cached data");
            restaurants = data;
            renderResults();
            return;
        }
    }

    // Overpass QL
    const radius = 2000; // 2km radius
    const query = `
        [out:json][timeout:25];
        (
          node["amenity"~"fast_food|restaurant|cafe|bar|pub"](around:${radius},${location.lat},${location.lng});
        );
        out body;
        >;
        out skel qt;
    `;

    try {
        const response = await fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: query
            // Overpass accepts POST body or GET query param
        });

        if (!response.ok) throw new Error('Overpass API error');

        const data = await response.json();
        restaurants = data.elements.filter(el => el.tags && (el.tags.name)); // Only show places with names for better UI

        // SET CACHE
        sessionStorage.setItem('listy_cache', JSON.stringify({
            lat: location.lat,
            lng: location.lng,
            data: restaurants,
            timestamp: Date.now()
        }));

        renderResults();

    } catch (error) {
        console.error("Fetch API error:", error);
        updatePlacesListState('error', 'Error al cargar restaurantes.');
    }
}

// Haversine Formula for distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c;
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// --- Rendering & UI ---
function updatePlacesListState(state, message = '') {
    placesList.innerHTML = '';

    if (state === 'loading') {
        placesList.innerHTML = `
            <div class="glass-panel p-4 rounded-xl animate-pulse">
                <div class="h-4 bg-slate-700 rounded w-3/4 mb-2"></div>
                <div class="h-3 bg-slate-700/50 rounded w-1/2"></div>
            </div>
            <div class="glass-panel p-4 rounded-xl animate-pulse delay-100">
                <div class="h-4 bg-slate-700 rounded w-2/3 mb-2"></div>
                <div class="h-3 bg-slate-700/50 rounded w-1/2"></div>
            </div>
        `;
        resultsCount.textContent = 'Buscando...';
    } else if (state === 'error') {
        placesList.innerHTML = `
            <div class="p-4 text-center text-red-400 glass-panel rounded-xl">
                <i class="fa-solid fa-triangle-exclamation mb-2 text-2xl"></i>
                <p>${message}</p>
                <button onclick="fetchNearbyRestaurants(currentUserLocation)" class="mt-2 text-xs underline hover:text-white">Reintentar</button>
            </div>
        `;
        resultsCount.textContent = 'Error';
    } else if (state === 'empty') {
        placesList.innerHTML = `
            <div class="p-4 text-center text-slate-400 glass-panel rounded-xl">
                <p>No se encontraron lugares cerca.</p>
            </div>
        `;
        resultsCount.textContent = '0 encontrados';
    }
}

function renderResults() {
    // Clear markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    if (restaurants.length === 0) {
        updatePlacesListState('empty');
        return;
    }

    resultsCount.textContent = `${restaurants.length} encontrados`;
    placesList.innerHTML = ''; // Clear loading state

    restaurants.forEach(place => {
        // Add Marker
        const marker = createRestaurantMarker(place);
        marker.addTo(map);
        markers.push(marker);

        // Add Tag to verify mapping
        place.marker_ref = marker;

        // Add Card
        const card = document.createElement('div');
        card.id = `card-${place.id}`;
        card.className = 'glass-panel p-4 rounded-xl cursor-pointer hover:bg-slate-800/50 transition-all duration-200 border-l-4 border-transparent hover:border-orange-500 group';

        let icon = 'fa-utensils';
        if (place.tags.amenity === 'cafe') icon = 'fa-mug-hot';
        if (place.tags.amenity === 'bar') icon = 'fa-wine-glass';

        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <h4 class="font-bold text-white group-hover:text-orange-400 transition-colors">${place.tags.name}</h4>
                    <p class="text-sm text-slate-400 mt-1 truncate max-w-[200px]">${place.tags['addr:street'] || 'Dirección no disponible'}</p>
                    <div class="mt-2 flex gap-2">
                        <span class="text-[10px] bg-slate-700/50 px-2 py-0.5 rounded text-slate-300 border border-slate-600">${place.tags.cuisine || place.tags.amenity}</span>
                    </div>
                </div>
                <div class="w-8 h-8 rounded-full bg-slate-700/50 flex items-center justify-center text-orange-500">
                    <i class="fa-solid ${icon} text-xs"></i>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            // Zoom to marker and open popup
            map.flyTo([place.lat, place.lon], 17);
            place.marker_ref.openPopup();

            // Highlight card visual
            document.querySelectorAll('#places-list > div').forEach(el => {
                el.classList.remove('border-orange-500', 'bg-slate-800');
                el.classList.add('border-transparent');
            });
            card.classList.remove('border-transparent');
            card.classList.add('border-orange-500', 'bg-slate-800');
        });

        placesList.appendChild(card);
    });
}

function highlightCard(placeId) {
    const card = document.getElementById(`card-${placeId}`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.click(); // Trigger the click style logic
    }
}

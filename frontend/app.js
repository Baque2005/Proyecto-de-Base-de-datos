const API_URL = "../backend/api.php";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]);
}

async function fetchData(action, params = "") {
  const response = await fetch(`${API_URL}?action=${action}${params}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No fue posible cargar los datos.");
  return result.data;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  document.querySelector("#toast-message").textContent = message;
  toast.classList.remove("translate-y-20", "opacity-0");
  window.setTimeout(() => toast.classList.add("translate-y-20", "opacity-0"), 3000);
}

function setActiveTab(tabName) {
  document.querySelectorAll(".app-view").forEach((view) => view.classList.add("hidden"));
  const view = document.querySelector(`#view-${tabName}`);
  if (view) view.classList.remove("hidden");

  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.classList.remove("border-blue-600","text-blue-600","font-semibold");
    button.classList.add("border-transparent","text-slate-500","font-medium");
  });
  const active = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (active) {
    active.classList.remove("border-transparent","text-slate-500","font-medium");
    active.classList.add("border-blue-600","text-blue-600","font-semibold");
  }
  history.replaceState(null, "", `#${tabName}`);
  if (window.lucide) lucide.createIcons();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (tabName === "reservas" && typeof loadReservations === "function") {
    loadReservations().catch((error) => showToast(error.message));
  }
}

function formatDate(value) {
  return new Date(value.replace(" ","T")).toLocaleString("es-EC", {
    weekday:"short", day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit"
  });
}

let allFlights = [];
let displayedFlights = [];
let flightsAscending = true;
let airports = [];
let reservationRows = [];
let reservationDateFilter = 0;
let reservationStateFilter = "TODAS";
let reservationPage = 1;
const reservationsPerPage = 8;
let realtimeRefreshTimer = null;
let reservationPassengerFilter = null;
let reservationSearchText = "";

async function refreshAllLiveData(options = {}) {
  const silent = options.silent !== false;
  if (!silent) showToast("Actualizando datos...");
  await Promise.all([
    loadSummary(),
    loadAirports(),
    loadFlights(),
    loadPassengers(),
    loadReservations(),
    loadPlanes()
  ]);
  if (!silent) showToast("Datos actualizados.");
}

async function loadSummary() {
  const [summary, airportData] = await Promise.all([
    fetchData("summary"),
    fetchData("airports")
  ]);
  const active = Number(summary.active_reservations || 0);
  document.querySelector("#header-active-count").textContent = String(active).padStart(2,"0");
  document.querySelector("#kpi-reservations").textContent = active;
  document.querySelector("#kpi-passengers").textContent = summary.registered_passengers;
  document.querySelector("#kpi-flights").textContent = summary.scheduled_flights;
  document.querySelector("#kpi-airports").textContent = airportData.length;
  document.querySelector("#tab-passengers-badge").textContent = summary.registered_passengers;
  document.querySelector("#tab-reservas-badge").textContent = active;
}

async function loadAirports() {
  airports = await fetchData("airports");
  document.querySelector("#airportGrid").innerHTML = airports.map((airport) => `
    <article class="airport-card">
      <span class="catalog-icon"><i data-lucide="map-pin"></i></span>
      <span class="text-xs font-semibold text-blue-600">${escapeHtml(airport.codigo_iata)}</span>
      <h3 class="mt-2 font-bold text-slate-900">${escapeHtml(airport.ciudad)}</h3>
      <p class="mt-1 text-sm text-slate-500">${escapeHtml(airport.nombre)}</p>
      <p class="mt-3 text-xs text-slate-400">${escapeHtml(airport.pais)}</p>
    </article>
  `).join("");

  const origin = document.querySelector("#origin");
  const destination = document.querySelector("#destination");
  origin.innerHTML = '<option value="">Todos los orígenes</option>' + airports.map((airport) =>
    `<option value="${escapeHtml(airport.codigo_iata)}">${escapeHtml(airport.ciudad)} (${escapeHtml(airport.codigo_iata)})</option>`
  ).join("");
  destination.innerHTML = '<option value="">Todos los destinos</option>' + airports.map((airport) =>
    `<option value="${escapeHtml(airport.codigo_iata)}">${escapeHtml(airport.ciudad)} (${escapeHtml(airport.codigo_iata)})</option>`
  ).join("");
}

function renderFlights(flights) {
  displayedFlights = [...flights];
  document.querySelector("#flightResultCount").textContent = `${flights.length} vuelo${flights.length === 1 ? "" : "s"}`;
  document.querySelector("#tab-flights-badge").textContent = flights.length;

  document.querySelector("#flightResults").innerHTML = flights.length ? flights.map((flight) => {
    const departure = new Date(flight.fecha_salida.replace(" ","T"));
    const arrival = new Date(flight.fecha_llegada.replace(" ","T"));
    const minutes = Math.max(0, Math.round((arrival-departure)/60000));
    const duration = `${Math.floor(minutes/60)} h ${minutes%60} min`;
    return `
      <article class="flight-card">
        <div class="airline-cell"><span class="airline-badge"><i data-lucide="plane"></i></span><div><strong>${escapeHtml(flight.codigo_vuelo)}</strong><small>${escapeHtml(flight.avion)}</small></div></div>
        <div class="time-cell"><div><strong>${departure.toLocaleTimeString("es-EC",{hour:"2-digit",minute:"2-digit"})}</strong><small>${escapeHtml(flight.ciudad_origen)} · ${escapeHtml(flight.origen)}</small></div></div>
        <div class="flight-route"><span></span><small>${duration}</small><span></span></div>
        <div class="time-cell"><div><strong>${arrival.toLocaleTimeString("es-EC",{hour:"2-digit",minute:"2-digit"})}</strong><small>${escapeHtml(flight.ciudad_destino)} · ${escapeHtml(flight.destino)}</small></div></div>
        <div class="flight-action"><small>Salida</small><strong>${formatDate(flight.fecha_salida)}</strong><button type="button" class="flight-select-button" data-flight-id="${flight.id}" data-flight-code="${escapeHtml(flight.codigo_vuelo)}">Ver asientos <i data-lucide="chevron-right"></i></button></div>
      </article>`;
  }).join("") : `<div class="flight-empty"><i data-lucide="search-x"></i><h3 class="font-bold text-slate-900">No encontramos vuelos</h3><p class="mt-1 text-sm">Prueba otra ruta o elimina los filtros.</p><button type="button" id="clearFlightFilters" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Ver todos los vuelos</button></div>`;

  document.querySelectorAll(".flight-select-button").forEach((button) => {
    button.addEventListener("click", () => openBookingModal(Number(button.dataset.flightId)));
  });
  document.querySelector("#clearFlightFilters")?.addEventListener("click", () => {
    document.querySelector("#origin").value = "";
    document.querySelector("#destination").value = "";
    document.querySelector("#departureDate").value = "";
    renderFlights(allFlights);
  });
  if (window.lucide) lucide.createIcons();
}

async function loadFlights() {
  allFlights = await fetchData("flights");
  renderFlights(allFlights);
  document.querySelector("#kpi-flights").textContent = allFlights.length;
  document.querySelector("#modalFlight").innerHTML = '<option value="">Selecciona un vuelo</option>' + allFlights.map((flight) =>
    `<option value="${flight.id}">${escapeHtml(flight.codigo_vuelo)} · ${escapeHtml(flight.ciudad_origen)} → ${escapeHtml(flight.ciudad_destino)}</option>`
  ).join("");
  renderPanelFlights(allFlights);
}

function renderPanelFlights(flights) {
  document.querySelector("#panelFlights").innerHTML = flights.slice(0,4).map((flight) => {
    const departure = new Date(flight.fecha_salida.replace(" ","T"));
    return `<tr class="hover:bg-slate-50/80"><td class="py-4 px-6 font-semibold text-slate-900"><span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full ${flight.estado === "PROGRAMADO" ? "bg-emerald-500" : "bg-blue-500"}"></span>${escapeHtml(flight.codigo_vuelo)}</span><small class="block pl-4 text-slate-400">${escapeHtml(flight.avion)}</small></td><td class="py-4 px-6"><div class="flex items-center gap-2 font-medium"><span>${escapeHtml(flight.origen)}</span><i data-lucide="arrow-right" class="w-3.5 h-3.5 text-slate-400"></i><span>${escapeHtml(flight.destino)}</span></div><small class="text-slate-400">${escapeHtml(flight.ciudad_origen)} a ${escapeHtml(flight.ciudad_destino)}</small></td><td class="py-4 px-6 text-slate-600"><strong class="block text-slate-800">${departure.toLocaleTimeString("es-EC",{hour:"2-digit",minute:"2-digit"})}</strong><small class="text-slate-400">${departure.toLocaleDateString("es-EC",{weekday:"short",day:"2-digit",month:"short"})}</small></td><td class="py-4 px-6"><span class="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">${escapeHtml(flight.estado)}</span></td></tr>`;
  }).join("") || '<tr><td colspan="4" class="py-8 text-center text-slate-400">No hay vuelos registrados.</td></tr>';
  if (window.lucide) lucide.createIcons();
}

async function loadPassengers() {
  const passengers = await fetchData("passengers");
  document.querySelector("#passengerGrid").innerHTML = passengers.map((passenger) => `
    <article class="passenger-card" role="button" tabindex="0" data-passenger-id="${passenger.id}" data-passenger-name="${escapeHtml(`${passenger.nombre} ${passenger.apellido}`)}" data-search="${escapeHtml(`${passenger.nombre} ${passenger.apellido} ${passenger.identificacion} ${passenger.email} ${passenger.telefono || ""}`)}">
      <div class="flex items-start justify-between"><div class="passenger-avatar">${escapeHtml(initials(passenger.nombre,passenger.apellido))}</div><span class="status-pill slate">${passenger.reservation_count} reserva(s)</span></div>
      <h3 class="mt-4 font-bold text-slate-900">${escapeHtml(passenger.nombre)} ${escapeHtml(passenger.apellido)}</h3>
      <p class="mt-1 text-xs text-slate-500">${escapeHtml(passenger.identificacion)}</p>
      <p class="mt-3 text-sm text-slate-600">${escapeHtml(passenger.email)}</p>
      <p class="mt-1 text-xs text-slate-400">${escapeHtml(passenger.telefono || "Sin teléfono")}</p>
    </article>
  `).join("");
  document.querySelectorAll(".passenger-card").forEach((card)=>{
    const openPassengerReservations=()=>{
      const passengerId=Number(card.dataset.passengerId);
      const passengerName=card.dataset.passengerName;
      reservationPassengerFilter=passengerId;
      reservationSearchText="";
      document.querySelector("#reservationSearch").value="";
      reservationStateFilter="TODAS";
      reservationDateFilter=0;
      document.querySelector("#reservationStateFilter").value="TODAS";
      document.querySelector("#reservationDateFilter").value="0";
      reservationPage=1;
      showPassengerReservationFilter(passengerName);
      setActiveTab("reservas");
      applyReservationFilters();
    };
    card.addEventListener("click",openPassengerReservations);
    card.addEventListener("keydown",(event)=>{
      if(event.key==="Enter"||event.key===" "){event.preventDefault();openPassengerReservations();}
    });
  });
}

function initials(firstName,lastName){return `${firstName?.[0]||""}${lastName?.[0]||""}`.toUpperCase();}

async function loadPlanes() {
  const [planes,seats] = await Promise.all([fetchData("planes"),fetchData("all-seats")]);
  document.querySelector("#planeGrid").innerHTML = planes.map((plane) =>
    `<button type="button" class="plane-card text-left" data-plane-id="${plane.id}"><span class="catalog-icon"><i data-lucide="plane"></i></span><span class="text-xs font-semibold text-blue-600">${escapeHtml(plane.matricula)}</span><h3 class="mt-2 font-bold text-slate-900">${escapeHtml(plane.modelo)}</h3><p class="mt-2 text-sm text-slate-500">Capacidad: ${plane.capacidad_total} pasajeros</p></button>`
  ).join("");
  document.querySelectorAll(".plane-card").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll(".plane-card").forEach((item)=>item.classList.remove("selected"));
    button.classList.add("selected");
    const filtered = await fetchData("all-seats",`&plane_id=${button.dataset.planeId}`);
    renderSeats(filtered);
  }));
  renderSeats(seats);
  if (window.lucide) lucide.createIcons();
}

function renderSeats(seats) {
  document.querySelector("#seatCatalog").innerHTML = seats.length ? seats.map((seat) =>
    `<span class="seat-chip">${escapeHtml(seat.numero_asiento)}<span>${escapeHtml(seat.clase)}</span></span>`
  ).join("") : '<p class="text-sm text-slate-400">No hay asientos registrados.</p>';
}

async function loadReservations() {
  const table = document.querySelector("#reservationTable");
  table.classList.add("is-loading");
  table.innerHTML = '<tr><td colspan="7" class="reservation-empty"><span class="reload-spinner"><i data-lucide="refresh-cw"></i> Actualizando reservas...</span></td></tr>';
  if (window.lucide) lucide.createIcons();
  try {
    reservationRows = await fetchData("reservations");
    applyReservationFilters();
    const active = reservationRows.filter((item) => item.estado !== "CANCELADA").length;
    document.querySelector("#tab-reservas-badge").textContent = active;
    document.querySelector("#header-active-count").textContent = String(active).padStart(2,"0");
    if (reservationRows[0]) renderRecentReservation(reservationRows[0]);
  } finally {
    table.classList.remove("is-loading");
  }
}

function renderRecentReservation(reservation) {
  document.querySelector("#recent-code").textContent = `#${reservation.codigo_reserva}`;
  document.querySelector("#recentReservation").innerHTML = `
    <div class="flex items-center justify-between"><span class="text-xs font-medium text-slate-500">Pasajero</span><strong class="text-sm text-slate-800">${escapeHtml(reservation.nombre)} ${escapeHtml(reservation.apellido)}</strong></div>
    <div class="flex items-center justify-between mt-3"><span class="text-xs font-medium text-slate-500">Vuelo asignado</span><strong class="text-sm text-blue-600">${escapeHtml(reservation.codigo_vuelo)} (${escapeHtml(reservation.ciudad_origen)} → ${escapeHtml(reservation.ciudad_destino)})</strong></div>
    <div class="flex items-center justify-between mt-3"><span class="text-xs font-medium text-slate-500">Asiento / Precio</span><span class="text-xs font-medium bg-white px-2 py-1 rounded border border-slate-200 text-slate-700">${escapeHtml(reservation.numero_asiento || "-")} · $${Number(reservation.precio||0).toFixed(2)}</span></div>`;
}

function showPassengerReservationFilter(passengerName) {
  const filter = document.querySelector("#reservationPassengerFilter");
  filter.innerHTML = `<i data-lucide="user-round"></i><span>${escapeHtml(passengerName)}</span><button type="button" id="clearPassengerReservationFilter" aria-label="Quitar filtro"><i data-lucide="x"></i></button>`;
  filter.classList.remove("hidden");
  document.querySelector("#clearPassengerReservationFilter").addEventListener("click",()=>{
    reservationPassengerFilter=null;
    filter.classList.add("hidden");
    filter.innerHTML="";
    applyReservationFilters();
  });
  if (window.lucide) lucide.createIcons();
}

function applyReservationFilters() {
  const today = new Date();
  let filtered = reservationRows.filter((reservation) => {
    const stateMatch = reservationStateFilter === "TODAS" || reservation.estado === reservationStateFilter;
    if (!stateMatch) return false;
    if (reservationPassengerFilter !== null &&
        Number(reservation.pasajero_id) !== reservationPassengerFilter) return false;
    if (reservationSearchText) {
      const searchable = [
        reservation.codigo_reserva,
        reservation.nombre,
        reservation.apellido,
        reservation.identificacion,
        reservation.telefono,
        reservation.email,
        reservation.codigo_vuelo,
        reservation.ciudad_origen,
        reservation.ciudad_destino,
        reservation.numero_asiento,
        reservation.estado,
        reservation.precio
      ].join(" ").toLocaleLowerCase("es");
      if (!searchable.includes(reservationSearchText)) return false;
    }
    if (reservationDateFilter === 0) return true;
    if (!reservation.fecha_reserva) return false;
    const limit = new Date(today);
    limit.setDate(limit.getDate()-reservationDateFilter);
    return new Date(reservation.fecha_reserva.replace(" ","T")) >= limit;
  });
  const totalPages = Math.max(1,Math.ceil(filtered.length/reservationsPerPage));
  reservationPage = Math.min(reservationPage,totalPages);
  const pageRows = filtered.slice((reservationPage-1)*reservationsPerPage,reservationPage*reservationsPerPage);
  document.querySelector("#reservationTable").innerHTML = pageRows.length ? pageRows.map((reservation) => `
    <tr>
      <td class="py-4 px-6 font-semibold text-slate-900">${escapeHtml(reservation.codigo_reserva)}</td>
      <td class="py-4 px-6"><strong class="block text-slate-800">${escapeHtml(reservation.nombre)} ${escapeHtml(reservation.apellido)}</strong></td>
      <td class="py-4 px-6"><strong class="block text-slate-800">${escapeHtml(reservation.codigo_vuelo)}</strong><small class="text-slate-400">${escapeHtml(reservation.ciudad_origen)} → ${escapeHtml(reservation.ciudad_destino)}</small></td>
      <td class="py-4 px-6">${escapeHtml(reservation.numero_asiento || "-")}</td>
      <td class="py-4 px-6 font-medium">$${Number(reservation.precio||0).toFixed(2)}</td>
      <td class="py-4 px-6"><span class="status-pill ${reservation.estado==="CANCELADA"?"slate":reservation.estado==="CONFIRMADA"?"emerald":"blue"}">${escapeHtml(reservation.estado)}</span></td>
      <td class="py-4 px-6"><button type="button" class="reservation-menu page-button" data-reservation-id="${reservation.id}" aria-label="Acciones"><i data-lucide="more-horizontal"></i></button></td>
    </tr>
  `).join("") : '<tr><td colspan="7" class="reservation-empty">No hay reservas con estos filtros.</td></tr>';

  document.querySelector("#reservationPageLabel").textContent = `Página ${reservationPage} de ${totalPages}`;
  document.querySelector("#reservationPrevPage").disabled = reservationPage <= 1;
  document.querySelector("#reservationNextPage").disabled = reservationPage >= totalPages;
  document.querySelectorAll(".reservation-menu").forEach((button) => button.addEventListener("click",(event)=>{
      event.stopPropagation();
    const reservation = reservationRows.find((item)=>item.id===Number(button.dataset.reservationId));
    showFloatingMenu(button,"Acciones",[
      {label:"Ver detalle",icon:"eye",action:()=>openReservationDetail(reservation)},
      ...(reservation.estado==="PENDIENTE" ? [{label:"Confirmar reserva",icon:"circle-check",action:()=>confirmReservation(reservation.id)}] : []),
      ...(reservation.estado==="CANCELADA"?[]:[{label:"Cancelar reserva",icon:"circle-x",action:()=>cancelReservation(reservation.id)}])
    ]);
  }));
  if (window.lucide) lucide.createIcons();
}

function showFloatingMenu(button,title,items) {
  const menu = document.querySelector("#floatingMenu");
  const rect = button.getBoundingClientRect();
  menu.innerHTML = `<strong>${escapeHtml(title)}</strong>`+items.map((item,index)=>
    `<button type="button" data-menu-index="${index}"><i data-lucide="${item.icon}"></i>${escapeHtml(item.label)}</button>`
  ).join("");
  menu.classList.remove("hidden");
  menu.style.left = `${Math.max(12,Math.min(rect.left,window.innerWidth-205))}px`;
  menu.style.top = `${rect.bottom+8}px`;
  menu.querySelectorAll("[data-menu-index]").forEach((option)=>option.addEventListener("click",()=>{
    menu.classList.add("hidden");
    items[Number(option.dataset.menuIndex)].action();
  }));
  if (window.lucide) lucide.createIcons();
}

function openReservationDetail(reservation) {
  const date = reservation.fecha_reserva
    ? new Date(reservation.fecha_reserva.replace(" ","T")).toLocaleString("es-EC")
    : "Sin fecha";
  document.querySelector("#detailCode").textContent = reservation.codigo_reserva;
  document.querySelector("#detailContent").innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="detail-card"><small>Pasajero</small><strong>${escapeHtml(reservation.nombre)} ${escapeHtml(reservation.apellido)}</strong></div>
      <div class="detail-card"><small>Vuelo</small><strong>${escapeHtml(reservation.codigo_vuelo)}</strong></div>
      <div class="detail-card"><small>Origen</small><strong>${escapeHtml(reservation.ciudad_origen)}</strong></div>
      <div class="detail-card"><small>Destino</small><strong>${escapeHtml(reservation.ciudad_destino)}</strong></div>
      <div class="detail-card"><small>Asiento</small><strong>${escapeHtml(reservation.numero_asiento || "-")}</strong></div>
      <div class="detail-card"><small>Precio</small><strong>$${Number(reservation.precio || 0).toFixed(2)}</strong></div>
      <div class="detail-card"><small>Estado</small><strong>${escapeHtml(reservation.estado)}</strong></div>
      <div class="detail-card"><small>Fecha de reserva</small><strong>${escapeHtml(date)}</strong></div>
    </div>`;
  document.querySelector("#detail-modal").classList.remove("hidden");
  document.querySelector("#detail-modal").classList.add("open");
  if (window.lucide) lucide.createIcons();
}

function closeReservationDetail() {
  document.querySelector("#detail-modal").classList.remove("open");
  document.querySelector("#detail-modal").classList.add("hidden");
}

function openReservationSuccess(reservation) {
  document.querySelector("#successCode").textContent = reservation.code;
  document.querySelector("#successContent").innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="detail-card"><small>Pasajero</small><strong>${escapeHtml(reservation.passenger)}</strong></div>
      <div class="detail-card"><small>Vuelo</small><strong>${escapeHtml(reservation.flight)}</strong></div>
      <div class="detail-card"><small>Asiento</small><strong>${escapeHtml(reservation.seat)}</strong></div>
      <div class="detail-card"><small>Precio</small><strong>$${Number(reservation.price || 0).toFixed(2)}</strong></div>
    </div>`;
  document.querySelector("#success-modal").classList.remove("hidden");
  document.querySelector("#success-modal").classList.add("open");
  if (window.lucide) lucide.createIcons();
}

function closeReservationSuccess() {
  document.querySelector("#success-modal").classList.remove("open");
  document.querySelector("#success-modal").classList.add("hidden");
}

async function refreshReservations() {
  const moreButton = document.querySelector("#reservationMoreButton");
  moreButton.disabled = true;
  moreButton.classList.add("is-refreshing");
  showToast("Actualizando reservas...");
  try {
    await refreshAllLiveData({silent:true});
    showToast("Lista actualizada correctamente.");
  } catch (error) {
    showToast(error.message || "No se pudo actualizar la lista.");
  } finally {
    moreButton.disabled = false;
    moreButton.classList.remove("is-refreshing");
  }
}

async function confirmReservation(reservationId) {
  if (!window.confirm("¿Deseas confirmar esta reserva y registrar el pago?")) return;
  const response = await fetch(`${API_URL}?action=confirm-reservation`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({reservation_id:Number(reservationId)})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error||"No fue posible confirmar.");
  showToast(result.message);
  await refreshAllLiveData({silent:true});
}

async function cancelReservation(reservationId) {
  if (!window.confirm("¿Deseas cancelar esta reserva y liberar su asiento?")) return;
  const response = await fetch(`${API_URL}?action=cancel-reservation`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reservation_id:Number(reservationId)})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error||"No fue posible cancelar.");
  showToast(result.message);
  await refreshAllLiveData({silent:true});
}

function openModal() {
  document.querySelector("#booking-modal").classList.add("open");
  document.querySelector("#booking-modal").classList.remove("hidden");
  document.querySelector("#reservationFlightId").value = "";
  document.querySelector("#reservationSeatId").value = "";
  document.querySelector("#modalFlight").value = "";
  document.querySelector("#modalSeat").innerHTML = '<option value="">Selecciona un vuelo</option>';
}

function closeModal() {
  document.querySelector("#booking-modal").classList.remove("open");
  document.querySelector("#booking-modal").classList.add("hidden");
}

async function openBookingModal(flightId = null) {
  openModal();
  if (flightId) {
    document.querySelector("#modalFlight").value = String(flightId);
    document.querySelector("#reservationFlightId").value = String(flightId);
    updateModalFlightSummary(flightId);
    await loadModalSeats(flightId);
  }
}

function updateModalFlightSummary(flightId) {
  const flight = allFlights.find((item) => item.id === Number(flightId));
  const summary = document.querySelector("#modalFlightSummary");
  if (!flight) {
    summary.classList.add("hidden");
    summary.innerHTML = "";
    return;
  }
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="modal-flight-summary">
      <span><i data-lucide="plane"></i></span>
      <div><strong>${escapeHtml(flight.codigo_vuelo)} · ${escapeHtml(flight.ciudad_origen)} → ${escapeHtml(flight.ciudad_destino)}</strong><small>${escapeHtml(flight.avion)} · ${formatDate(flight.fecha_salida)}</small></div>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

async function loadModalSeats(flightId) {
  const select = document.querySelector("#modalSeat");
  select.disabled = true;
  select.innerHTML = '<option value="">Consultando asientos disponibles...</option>';
  try {
    const seats = await fetchData("seats",`&flight_id=${flightId}`);
    select.innerHTML = seats.length ? '<option value="">Selecciona un asiento</option>' + seats.map((seat)=>
      `<option value="${seat.id}">${escapeHtml(seat.numero_asiento)} · ${escapeHtml(seat.clase)}</option>`
    ).join("") : '<option value="">No quedan asientos disponibles</option>';
  } catch (error) {
    select.innerHTML = '<option value="">No fue posible consultar</option>';
    showToast(error.message);
  } finally {
    select.disabled = false;
  }
}

document.querySelector("#newBookingButton").addEventListener("click",()=>openModal());
document.querySelector("#panelNewBooking").addEventListener("click",()=>openModal());
document.querySelector("#closeModalButton").addEventListener("click",closeModal);
document.querySelector("#cancelModalButton").addEventListener("click",closeModal);
document.querySelector("#booking-modal").addEventListener("click",(event)=>{
  if (event.target.id==="booking-modal") closeModal();
});

document.querySelector("#closeDetailModal").addEventListener("click",closeReservationDetail);
document.querySelector("#detailDoneButton").addEventListener("click",closeReservationDetail);
document.querySelector("#detail-modal").addEventListener("click",(event)=>{
  if (event.target.id==="detail-modal") closeReservationDetail();
});

document.querySelector("#closeSuccessModal").addEventListener("click",closeReservationSuccess);
document.querySelector("#successViewReservations").addEventListener("click",()=>{
  closeReservationSuccess();
  setActiveTab("reservas");
});
document.querySelector("#success-modal").addEventListener("click",(event)=>{
  if (event.target.id==="success-modal") closeReservationSuccess();
});

document.querySelector("#helpButton").addEventListener("click",()=>showToast("Sistema académico de gestión aeroportuaria"));

document.querySelector("#modalFlight").addEventListener("change",(event)=>{
  const flightId = Number(event.target.value);
  document.querySelector("#reservationFlightId").value = flightId ? String(flightId) : "";
  document.querySelector("#reservationSeatId").value = "";
  if (flightId) {
    updateModalFlightSummary(flightId);
    loadModalSeats(flightId);
  } else {
    document.querySelector("#modalFlightSummary").classList.add("hidden");
    document.querySelector("#modalFlightSummary").innerHTML = "";
  }
});

document.querySelector("#modalSeat").addEventListener("change",(event)=>{
  document.querySelector("#reservationSeatId").value = event.target.value;
});

document.querySelector("#swapLocations").addEventListener("click",()=>{
  const origin=document.querySelector("#origin");
  const destination=document.querySelector("#destination");
  [origin.value,destination.value]=[destination.value,origin.value];
});

document.querySelector("#flightSearchForm").addEventListener("submit",async(event)=>{
  event.preventDefault();
  const results=document.querySelector("#flightResults");
  results.innerHTML='<div class="flight-loading"><i data-lucide="loader-circle"></i><p>Buscando vuelos disponibles...</p></div>';
  if (window.lucide) lucide.createIcons();
  try {
    const origin=document.querySelector("#origin").value;
    const destination=document.querySelector("#destination").value;
    const date=document.querySelector("#departureDate").value;
    const flights=await fetchData("flights",`&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=${encodeURIComponent(date)}`);
    renderFlights(flights);
  } catch(error) {
    results.innerHTML='<div class="flight-empty"><i data-lucide="circle-alert"></i><h3 class="font-bold">No se pudo consultar el servicio</h3></div>';
    showToast(error.message);
  }
  if (window.lucide) lucide.createIcons();
});

document.querySelector("#sortFlightsButton").addEventListener("click",(event)=>{
  flightsAscending=!flightsAscending;
  const sorted=[...displayedFlights].sort((a,b)=>flightsAscending?a.fecha_salida.localeCompare(b.fecha_salida):b.fecha_salida.localeCompare(a.fecha_salida));
  event.currentTarget.innerHTML=`${flightsAscending?"Más próximos":"Más tardíos"} <i data-lucide="chevron-down"></i>`;
  renderFlights(sorted);
});

document.querySelector("#passengerSearch").addEventListener("input",(event)=>{
  const search=event.target.value.trim().toLocaleLowerCase("es");
  document.querySelectorAll(".passenger-card").forEach((card)=>{
    card.classList.toggle("hidden",!card.dataset.search.toLocaleLowerCase("es").includes(search));
  });
});

document.querySelector("#airportSearch").addEventListener("input",(event)=>{
  const search=event.target.value.trim().toLocaleLowerCase("es");
  document.querySelectorAll(".airport-card").forEach((card)=>{
    card.classList.toggle("hidden",!card.textContent.toLocaleLowerCase("es").includes(search));
  });
});

document.querySelector("#planeSearch").addEventListener("input",(event)=>{
  const search=event.target.value.trim().toLocaleLowerCase("es");
  document.querySelectorAll(".plane-card").forEach((card)=>{
    card.classList.toggle("hidden",!card.textContent.toLocaleLowerCase("es").includes(search));
  });
});

document.querySelector("#reservationDateFilter").addEventListener("change",(event)=>{
  reservationDateFilter=Number(event.target.value);
  reservationPage=1;
  applyReservationFilters();
});

document.querySelector("#reservationStateFilter").addEventListener("change",(event)=>{
  reservationStateFilter=event.target.value;
  reservationPage=1;
  applyReservationFilters();
});

document.querySelector("#reservationSearch").addEventListener("input",(event)=>{
  reservationSearchText=event.target.value.trim().toLocaleLowerCase("es");
  reservationPage=1;
  applyReservationFilters();
});

document.querySelector("#reservationPrevPage").addEventListener("click",()=>{
  if(reservationPage>1){reservationPage--;applyReservationFilters();}
});
document.querySelector("#reservationNextPage").addEventListener("click",()=>{
  reservationPage++;applyReservationFilters();
});

document.querySelector("#reservationMoreButton").addEventListener("click",(event)=>{
  event.stopPropagation();
  showFloatingMenu(event.currentTarget,"Reservas",[
    {label:"Nueva reserva",icon:"plus",action:()=>openModal()},
    {label:"Actualizar lista",icon:"refresh-cw",action:()=>refreshReservations()},
    {label:"Quitar filtros",icon:"filter-x",action:()=>{reservationDateFilter=0;reservationStateFilter="TODAS";reservationPassengerFilter=null;reservationSearchText="";reservationPage=1;document.querySelector("#reservationDateFilter").value="0";document.querySelector("#reservationStateFilter").value="TODAS";document.querySelector("#reservationSearch").value="";document.querySelector("#reservationPassengerFilter").classList.add("hidden");document.querySelector("#reservationPassengerFilter").innerHTML="";applyReservationFilters();}}
  ]);
});

document.querySelector("#reservationForm").addEventListener("submit",async(event)=>{
  event.preventDefault();
  const form = event.currentTarget;
  const flightId=Number(document.querySelector("#reservationFlightId").value);
  const seatId=Number(document.querySelector("#modalSeat").value);
  if(!flightId||!seatId){showToast("Selecciona un vuelo y asiento.");return;}
  const submit=form.querySelector('button[type="submit"]');
  submit.disabled=true;
  try {
    const response=await fetch(`${API_URL}?action=reservations`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        flight_id:flightId,seat_id:seatId,
        identificacion:document.querySelector("#passengerIdentification").value,
        nombre:document.querySelector("#passengerFirstName").value,
        apellido:document.querySelector("#passengerLastName").value,
        email:document.querySelector("#passengerEmail").value,
        telefono:document.querySelector("#passengerPhone").value,
        precio:Number(document.querySelector("#reservationPrice").value)
      })
    });
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||"No fue posible crear la reserva.");
    const selectedFlight=document.querySelector("#modalFlight").selectedOptions[0]?.textContent||"Vuelo seleccionado";
    const selectedSeat=document.querySelector("#modalSeat").selectedOptions[0]?.textContent||"Asiento seleccionado";
    const passengerName=`${document.querySelector("#passengerFirstName").value} ${document.querySelector("#passengerLastName").value}`;
    const price=Number(document.querySelector("#reservationPrice").value);
    closeModal();
    await refreshAllLiveData({silent:true});
    form.reset();
    document.querySelector("#modalSeat").innerHTML='<option value="">Selecciona un vuelo</option>';
    openReservationSuccess({
      code:result.data.codigo_reserva,
      passenger:passengerName,
      flight:selectedFlight,
      seat:selectedSeat,
      price
    });
  } catch(error) {
    showToast(error.message);
  } finally {
    submit.disabled=false;
  }
});

document.addEventListener("click",(event)=>{
  if (
    !event.target.closest("#floatingMenu") &&
    !event.target.closest("#reservationMoreButton") &&
    !event.target.closest(".reservation-menu")
  ) {
    document.querySelector("#floatingMenu").classList.add("hidden");
  }
});

document.addEventListener("click",(event)=>{
  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    event.preventDefault();
    setActiveTab(tabButton.dataset.tab);
  }
});

async function initialize() {
  try {
    await refreshAllLiveData({silent:true});
  } catch(error) {
    showToast(error.message);
  }
  const hash=location.hash.slice(1);
  setActiveTab(["panel","vuelos","reservas","pasajeros","aeropuertos","aviones"].includes(hash)?hash:"panel");
  if(window.lucide) lucide.createIcons();
}

initialize();

realtimeRefreshTimer = window.setInterval(() => {
  if (!document.hidden) {
    refreshAllLiveData({silent:true}).catch((error)=>showToast(error.message));
  }
}, 30000);

document.addEventListener("visibilitychange",()=>{
  if (!document.hidden) {
    refreshAllLiveData({silent:true}).catch((error)=>showToast(error.message));
  }
});

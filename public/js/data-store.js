let _clients = [];
let _index = 0;

export async function loadClients(url = "assets/clients/clients.json") {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Clients load failed: ${res.status}`);
  _clients = await res.json();
  _index = 0;
  return _clients;
}

export function getClients() { return _clients; }
export function getCurrentClient() { return _clients[_index] || null; }
export function getCurrentIndex() { return _index; }

export function setCurrentById(id) {
  const idx = _clients.findIndex(c => c.id === id);
  if (idx >= 0) _index = idx;
  return getCurrentClient();
}

export function nextClient() {
  if (!_clients.length) return null;
  _index = (_index + 1) % _clients.length;
  return getCurrentClient();
}

export function prevClient() {
  if (!_clients.length) return null;
  _index = (_index - 1 + _clients.length) % _clients.length;
  return getCurrentClient();
}

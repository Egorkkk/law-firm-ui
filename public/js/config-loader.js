export async function loadConfig(url = "assets/config.json") {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Config load failed: ${res.status}`);
  return await res.json();
}

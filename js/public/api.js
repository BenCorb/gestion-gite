export async function fetchJson(url, options = {}, fallbackMessage = "Action impossible.") {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Connexion impossible. Vérifiez votre réseau puis réessayez.");
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }
  return data;
}

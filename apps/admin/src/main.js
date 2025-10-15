const out = document.getElementById("out");
document.getElementById("ping").onclick = async () => {
  try {
    const r = await fetch("https://api.goldshore.org/health");
    out.textContent = await r.text();
  } catch (e) {
    out.textContent = "API error: " + e.message;
  }
};

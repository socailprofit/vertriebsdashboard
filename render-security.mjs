export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

// Database colours are data, not arbitrary inline CSS or attribute markup.
export function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? value : "#8fa3bf";
}

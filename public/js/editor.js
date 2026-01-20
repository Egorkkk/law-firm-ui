export function attachRichEditor({ container, toggleBtn }) {
  let editing = false;

  function setEditing(on) {
    editing = on;
    container.setAttribute("contenteditable", on ? "true" : "false");
    toggleBtn.textContent = on ? "Готово" : "Редактировать";
  }

  toggleBtn.addEventListener("click", () => setEditing(!editing));

  // default off
  setEditing(false);

  return { setEditing };
}

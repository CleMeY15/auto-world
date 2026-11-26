(() => {
  const rail = document.querySelector(".rail");
  if (!rail) return;
  const tabs = Array.from(rail.querySelectorAll("a"));
  const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));
  if (panels.some(panel => !panel)) return;

  const controls = document.querySelector(".phase-controls");
  const previous = controls.querySelector("[data-previous]");
  const next = controls.querySelector("[data-next]");
  let selected;

  function select(index, focus = false) {
    if (index < 0 || index >= tabs.length) return;
    selected = index;
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.tabIndex = active ? 0 : -1;
      tab.setAttribute("aria-selected", String(active));
      panels[i].hidden = !active;
    });
    previous.setAttribute("aria-disabled", String(index === 0));
    next.setAttribute("aria-disabled", String(index === tabs.length - 1));
    if (focus) tabs[index].focus();
  }

  rail.setAttribute("role", "tablist");
  rail.setAttribute("aria-label", "Étapes du déploiement");
  tabs.forEach((tab, i) => {
    const panel = panels[i];
    tab.id = `tab-${panel.id}`;
    tab.parentElement.setAttribute("role", "presentation");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.tabIndex = 0;
    tab.addEventListener("click", event => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      select(i);
    });
    tab.addEventListener("keydown", event => {
      let target;
      switch (event.key) {
        case "ArrowRight": target = (i + 1) % tabs.length; break;
        case "ArrowLeft": target = (i + tabs.length - 1) % tabs.length; break;
        case "Home": target = 0; break;
        case "End": target = tabs.length - 1; break;
        case " ": target = i; break;
        default: return;
      }
      event.preventDefault();
      select(target, true);
    });
  });
  const linked = tabs.findIndex(tab => tab.hash === location.hash);
  select(linked >= 0 ? linked : tabs.findIndex(tab => tab.getAttribute("aria-current") === "step"));
  previous.addEventListener("click", () => select(selected - 1, true));
  next.addEventListener("click", () => select(selected + 1, true));
  controls.hidden = false;
})();

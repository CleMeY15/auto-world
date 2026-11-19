(() => {
  const timer = document.querySelector("[data-deadline]");
  const clock = timer.querySelector(".clock");
  if (clock.hidden) return;
  const control = timer.querySelector("button");
  const expired = timer.querySelector(".expired");
  const digits = [...clock.querySelectorAll("b")];
  const deadline = Date.parse(timer.dataset.deadline);
  let interval;
  let paused = false;

  function draw() {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining === 0) {
      clock.hidden = control.hidden = true;
      expired.hidden = false;
      clearInterval(interval);
      return false;
    }
    const values = [Math.floor(remaining / 86400), Math.floor(remaining / 3600) % 24,
      Math.floor(remaining / 60) % 60, remaining % 60];
    values.forEach((value, i) => { digits[i].textContent = String(value).padStart(2, "0"); });
    return true;
  }

  function sync() {
    clearInterval(interval);
    if (!document.hidden && !paused && draw()) interval = setInterval(draw, 1000);
  }
  if (!draw()) return;
  control.hidden = false;
  control.addEventListener("click", () => {
    paused = !paused;
    control.textContent = paused ? "Reprendre" : "Figer";
    sync();
  });
  document.addEventListener("visibilitychange", sync);
  sync();
})();

(() => {
  const track = document.querySelector(".road-track");
  if (!track) return;
  const navigation = document.querySelector(".road-nav");
  const [previous, next] = navigation.querySelectorAll("button");
  const stops = [...track.querySelectorAll(".milestones li")];

  function updateNavigation() {
    const end = track.scrollWidth - track.clientWidth;
    navigation.hidden = end <= 1;
    track.tabIndex = navigation.hidden ? -1 : 0;
    previous.setAttribute("aria-disabled", String(track.scrollLeft <= 1));
    next.setAttribute("aria-disabled", String(track.scrollLeft >= end - 1));
  }

  function move(forward) {
    const left = track.getBoundingClientRect().left;
    const offsets = stops.map(stop => stop.getBoundingClientRect().left - left);
    const distance = forward ? offsets.find(x => x > 1) : offsets.findLast(x => x < -1);
    if (distance !== undefined) track.scrollBy({ left: distance });
  }

  previous.addEventListener("click", () => move(false));
  next.addEventListener("click", () => move(true));
  track.addEventListener("scroll", updateNavigation, { passive: true });
  new ResizeObserver(updateNavigation).observe(track);
})();

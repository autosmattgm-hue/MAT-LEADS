/* Small, dependency-free enhancements for the public homepage. */
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function initReveal() {
  const items = document.querySelectorAll(".landing-step, .landing-tool-card, .landing-evidence-card, .landing-cta-card");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries, instance) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      instance.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  items.forEach((item) => observer.observe(item));
}

function initAnchorLinks() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", link.getAttribute("href"));
  });
}

function initTestimonials() {
  const section = document.querySelector("#customer-perspectives");
  const track = section?.querySelector(".testimonial-grid");
  const cards = track ? [...track.querySelectorAll(".testimonial-card")] : [];
  if (!section || !track || cards.length < 2) return;

  let activeIndex = 0;
  let timer = null;
  let paused = reduceMotion;
  let userPaused = reduceMotion;
  let isHovering = false;
  let pointerStart = null;
  const controls = document.createElement("div");
  controls.className = "testimonial-controls";
  controls.setAttribute("aria-label", "Testimonial controls");
  controls.innerHTML = `<button class="testimonial-arrow" type="button" data-testimonial-prev aria-label="Previous testimonial">&#8592;</button><div class="testimonial-dots" role="tablist" aria-label="Choose a testimonial"></div><span class="testimonial-status" aria-live="polite"></span><button class="testimonial-arrow" type="button" data-testimonial-next aria-label="Next testimonial">&#8594;</button><button class="testimonial-toggle" type="button" data-testimonial-toggle aria-label="Pause testimonials" aria-pressed="false">&#9208;</button>`;
  section.querySelector(".testimonial-grid")?.after(controls);
  const dots = controls.querySelector(".testimonial-dots");
  const status = controls.querySelector(".testimonial-status");
  const toggle = controls.querySelector("[data-testimonial-toggle]");

  cards.forEach((card, index) => {
    card.setAttribute("role", "tabpanel");
    card.setAttribute("aria-roledescription", "slide");
    card.setAttribute("aria-label", `Testimonial ${index + 1} of ${cards.length}`);
    card.hidden = index !== activeIndex;
    const dot = document.createElement("button");
    dot.className = "testimonial-dot";
    dot.type = "button";
    dot.dataset.testimonialIndex = String(index);
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", `Show testimonial ${index + 1}`);
    dots.append(dot);
  });

  function render() {
    cards.forEach((card, index) => {
      card.hidden = index !== activeIndex;
      card.setAttribute("aria-hidden", String(index !== activeIndex));
    });
    controls.querySelectorAll(".testimonial-dot").forEach((dot, index) => {
      const active = index === activeIndex;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-selected", String(active));
      dot.tabIndex = active ? 0 : -1;
    });
    if (status) status.textContent = `${activeIndex + 1} / ${cards.length}`;
    if (toggle) {
      toggle.innerHTML = userPaused ? "&#9654;" : "&#9208;";
      toggle.setAttribute("aria-label", userPaused ? "Play testimonials" : "Pause testimonials");
      toggle.setAttribute("aria-pressed", String(userPaused));
    }
  }

  function stopTimer() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function startTimer() {
    stopTimer();
    if (!paused) timer = window.setInterval(() => { activeIndex = (activeIndex + 1) % cards.length; render(); }, 6500);
  }

  function goTo(index) {
    activeIndex = (index + cards.length) % cards.length;
    render();
    startTimer();
  }

  controls.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-testimonial-prev]")) goTo(activeIndex - 1);
    if (target.matches("[data-testimonial-next]")) goTo(activeIndex + 1);
    if (target.matches("[data-testimonial-index]")) goTo(Number(target.dataset.testimonialIndex));
    if (target.matches("[data-testimonial-toggle]")) { userPaused = !userPaused; paused = userPaused || isHovering; render(); startTimer(); }
  });

  section.addEventListener("mouseenter", () => { isHovering = true; paused = true; render(); stopTimer(); });
  section.addEventListener("mouseleave", () => { isHovering = false; if (!reduceMotion) { paused = userPaused; render(); startTimer(); } });
  section.addEventListener("focusin", () => { stopTimer(); });
  section.addEventListener("focusout", (event) => { if (!section.contains(event.relatedTarget) && !paused) startTimer(); });
  section.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(activeIndex - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(activeIndex + 1); }
  });
  track.addEventListener("pointerdown", (event) => { pointerStart = event.clientX; });
  track.addEventListener("pointerup", (event) => {
    if (pointerStart === null) return;
    const distance = event.clientX - pointerStart;
    pointerStart = null;
    if (Math.abs(distance) > 50) goTo(activeIndex + (distance < 0 ? 1 : -1));
  });
  render();
  startTimer();
}

document.addEventListener("DOMContentLoaded", () => {
  initReveal();
  initAnchorLinks();
  initTestimonials();
});

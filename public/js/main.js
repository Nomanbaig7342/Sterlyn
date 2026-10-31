(() => {
  "use strict";

  const API = ""; // same-origin. Set to e.g. "https://api.sterlyn.com" if frontend/backend are split.

  document.getElementById("year").textContent = new Date().getFullYear();

  // ---------- nav ----------
  const nav = document.getElementById("nav");
  window.addEventListener("scroll", () => {
    nav.classList.toggle("scrolled", window.scrollY > 20);
  });

  const navToggle = document.getElementById("navToggle");
  const navLinks = document.querySelector(".nav-links");
  navToggle.addEventListener("click", () => {
    const open = navLinks.style.display === "flex";
    navLinks.style.display = open ? "none" : "flex";
    navLinks.style.cssText += open
      ? ""
      : "flex-direction:column;position:absolute;top:100%;left:0;right:0;background:var(--bone);padding:24px var(--pad);gap:20px;border-bottom:1px solid var(--line);";
  });
  navLinks.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      if (window.innerWidth <= 900) navLinks.style.display = "none";
    })
  );

  // ---------- scroll reveal ----------
  const revealEls = document.querySelectorAll(".reveal");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealEls.forEach((el) => io.observe(el));

  // ---------- portfolio ----------
  const scroller = document.getElementById("portfolioScroller");
  const filters = document.getElementById("filters");
  let portfolioData = [];

  function renderPortfolio(filter) {
    const items =
      filter === "All" ? portfolioData : portfolioData.filter((p) => p.category === filter);

    if (!items.length) {
      scroller.innerHTML = `<p class="muted">No projects in this category yet.</p>`;
      return;
    }

    scroller.innerHTML = items
      .map(
        (p) => `
      <article class="pf-card">
        <img class="pf-img" src="${p.image}" alt="${escapeHTML(p.title)}" loading="lazy">
        <div class="pf-meta">
          <div>
            <h3>${escapeHTML(p.title)}</h3>
            <p class="muted" style="margin-top:4px; font-size:14px;">${escapeHTML(p.location)} — ${escapeHTML(p.year)}</p>
          </div>
          <span class="tag">${escapeHTML(p.category)}</span>
        </div>
        <p class="pf-blurb">${escapeHTML(p.blurb)}</p>
      </article>`
      )
      .join("");
  }

  function escapeHTML(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
  }

  async function loadPortfolio() {
    try {
      const res = await fetch(`${API}/api/portfolio`);
      const json = await res.json();
      portfolioData = json.data || [];
      renderPortfolio("All");
    } catch (e) {
      scroller.innerHTML = `<p class="muted">Couldn't load the portfolio right now. Please refresh.</p>`;
    }
  }
  loadPortfolio();

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    filters.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderPortfolio(btn.dataset.filter);
  });

  // ---------- testimonials ----------
  const testiSlides = document.getElementById("testiSlides");
  const testiDots = document.getElementById("testiDots");
  let testiIndex = 0;
  let testiTimer;

  async function loadTestimonials() {
    try {
      const res = await fetch(`${API}/api/testimonials`);
      const json = await res.json();
      const list = json.data || [];
      if (!list.length) return;

      testiSlides.innerHTML = list
        .map(
          (t, i) => `
        <div class="testi-slide ${i === 0 ? "active" : ""}" data-i="${i}">
          <p class="testi-quote">"${escapeHTML(t.quote)}"</p>
          <p class="testi-by">${escapeHTML(t.name)} — ${escapeHTML(t.project)}</p>
        </div>`
        )
        .join("");

      testiDots.innerHTML = list
        .map((_, i) => `<button class="testi-dot ${i === 0 ? "active" : ""}" data-i="${i}" aria-label="Testimonial ${i + 1}"></button>`)
        .join("");

      testiDots.addEventListener("click", (e) => {
        const dot = e.target.closest(".testi-dot");
        if (!dot) return;
        showTesti(Number(dot.dataset.i));
        resetTestiTimer();
      });

      resetTestiTimer();
    } catch (e) {
      /* silently ignore — section just stays empty */
    }
  }

  function showTesti(i) {
    const slides = testiSlides.querySelectorAll(".testi-slide");
    const dots = testiDots.querySelectorAll(".testi-dot");
    if (!slides.length) return;
    testiIndex = (i + slides.length) % slides.length;
    slides.forEach((s) => s.classList.remove("active"));
    dots.forEach((d) => d.classList.remove("active"));
    slides[testiIndex].classList.add("active");
    dots[testiIndex].classList.add("active");
  }

  function resetTestiTimer() {
    clearInterval(testiTimer);
    testiTimer = setInterval(() => showTesti(testiIndex + 1), 6000);
  }

  loadTestimonials();

  // ---------- contact form ----------
  const form = document.getElementById("contactForm");
  const submitBtn = document.getElementById("submitBtn");
  const formStatus = document.getElementById("formStatus");

  function setFieldError(fieldId, msg) {
    const field = document.getElementById(`field-${fieldId}`);
    if (!field) return;
    field.classList.toggle("error", !!msg);
    const err = field.querySelector(".field-error");
    if (err) err.textContent = msg || "";
  }

  function clearErrors() {
    ["name", "email", "message"].forEach((f) => setFieldError(f, ""));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    formStatus.textContent = "";
    formStatus.className = "form-status";

    const payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      projectType: form.projectType.value,
      budget: form.budget.value,
      message: form.message.value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      const res = await fetch(`${API}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        if (json.fields) {
          Object.entries(json.fields).forEach(([field, msg]) => setFieldError(field, msg));
        }
        formStatus.textContent = json.error || "Something went wrong. Please try again.";
        formStatus.classList.add("err");
        return;
      }

      formStatus.textContent = json.message || "Thanks — we'll be in touch shortly.";
      formStatus.classList.add("ok");
      form.reset();
    } catch (err) {
      formStatus.textContent = "Network error — please check your connection and try again.";
      formStatus.classList.add("err");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send inquiry";
    }
  });

  // ---------- newsletter form ----------
  const newsletterForm = document.getElementById("newsletterForm");
  const newsletterStatus = document.getElementById("newsletterStatus");

  newsletterForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("newsletterEmail").value.trim();
    newsletterStatus.textContent = "Subscribing…";
    newsletterStatus.className = "form-status";

    try {
      const res = await fetch(`${API}/api/newsletter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      newsletterStatus.textContent = json.message || (res.ok ? "Subscribed." : "Something went wrong.");
      if (res.ok) newsletterForm.reset();
    } catch (err) {
      newsletterStatus.textContent = "Network error — please try again.";
    }
  });
})();

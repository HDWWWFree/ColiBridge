/* Colibridge — application web (HTML/CSS/JS vanilla + Supabase). Aucun build requis. */
(() => {
  'use strict';

  const cfg = window.COLIBRIDGE_CONFIG || {};
  const CH = window.COLIBRIDGE_CHARTER;
  const main = document.getElementById('main');
  const modal = document.getElementById('modal');

  if (!cfg.SUPABASE_URL || /VOTRE/.test(cfg.SUPABASE_URL) || !cfg.SUPABASE_ANON_KEY || /VOTRE/.test(cfg.SUPABASE_ANON_KEY)) {
    main.innerHTML = `<div class="notice warn"><h2>Configuration manquante</h2>
      <p>Renseignez l’URL et la clé « anon » de votre projet Supabase dans <code>config.js</code>, puis rechargez la page.</p></div>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  /* ------------------------------------------------------------------ */
  /* Données de référence                                               */
  /* ------------------------------------------------------------------ */
  // Pays : chargés depuis la table `countries` de Supabase (ajouter un pays = une ligne SQL, aucun code).
  // Liste de secours si la table n'est pas lisible.
  const HOME = 'FR';
  let COUNTRY_LIST = [{ code: 'FR', name: 'France', currency: 'EUR' }, { code: 'DZ', name: 'Algérie', currency: 'DZD' }, { code: 'MA', name: 'Maroc', currency: 'MAD' }, { code: 'TN', name: 'Tunisie', currency: 'TND' }];
  let COUNTRIES = Object.fromEntries(COUNTRY_LIST.map((c) => [c.code, c.name]));
  const foreign = () => COUNTRY_LIST.filter((c) => c.code !== HOME);
  const countryOptions = (sel = '') => foreign().map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const countryName = (code) => COUNTRIES[code] || code;
  const currencies = () => [...new Set(['EUR', ...COUNTRY_LIST.map((c) => c.currency).filter(Boolean)])];
  const MODES = {
    voiture: { icon: '🚗', label: 'Voiture' },
    fourgon: { icon: '🚐', label: 'Fourgon' },
    camionnette: { icon: '🛻', label: 'Camionnette' },
    avion: { icon: '✈️', label: 'Avion' },
    bus: { icon: '🚌', label: 'Bus' },
    bateau: { icon: '⛴️', label: 'Bateau' }
  };
  const ROAD = ['voiture', 'fourgon', 'camionnette'];
  const STATUS = {
    pending: ['En attente', 'warn'],
    accepted: ['Acceptée', 'ok'],
    picked_up: ['Colis récupéré', 'info'],
    delivered: ['Livrée', 'done'],
    refused: ['Refusée', 'off'],
    cancelled: ['Annulée', 'off']
  };
  const TRIP_STATUS = { open: 'Ouvert', full: 'Complet', departed: 'Parti', completed: 'Terminé', cancelled: 'Annulé' };
  const CATEGORIES = {
    vetements: 'Vêtements', documents: 'Documents', electronique: 'Électronique',
    cadeaux: 'Cadeaux', alimentaire: 'Alimentaire non périssable', autre: 'Autre'
  };
  const REPORT_REASONS = {
    contenu_illicite: 'Contenu illicite ou interdit', colis_suspect: 'Colis suspect',
    comportement: 'Comportement inapproprié', fraude: 'Fraude ou arnaque', autre: 'Autre'
  };
  // Suggestions de villes par pays (saisie libre possible ; un nouveau pays n'a pas besoin d'y figurer).
  const CITIES = {
    FR: ['Paris', 'Marseille', 'Lyon', 'Lille', 'Toulouse', 'Nice', 'Bordeaux', 'Strasbourg', 'Nantes', 'Montpellier', 'Sète', 'Perpignan', 'Grenoble', 'Saint-Étienne', 'Rennes'],
    DZ: ['Alger', 'Oran', 'Constantine', 'Annaba', 'Béjaïa', 'Tizi Ouzou', 'Sétif', 'Tlemcen', 'Blida', 'Batna'],
    MA: ['Casablanca', 'Rabat', 'Tanger', 'Marrakech', 'Fès', 'Agadir'],
    TN: ['Tunis', 'Sfax', 'Sousse', 'Bizerte']
  };
  const citiesOf = (code) => CITIES[code] || [];
  const cityOptions = (list) => list.map((c) => `<option value="${esc(c)}">`).join('');

  /* ------------------------------------------------------------------ */
  /* État et utilitaires                                                */
  /* ------------------------------------------------------------------ */
  const S = { session: null, profile: null, traveler: null, next: null, authTab: 'login', filters: { dir: '', country: '', city: '', date: '', mode: '' }, chatChannel: null, seen: new Set() };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const money = (n, cur = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
  const kg = (n) => `${Number(n).toLocaleString('fr-FR')} kg`;
  const localISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const uid = () => S.session?.user?.id;
  const opts = (obj, sel = '') => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function friendly(err) {
    const m = (err && err.message) || String(err);
    if (/Capacité insuffisante/i.test(m)) return 'Capacité insuffisante sur ce trajet.';
    if (/row-level security|violates row-level/i.test(m)) return 'Action refusée : vérifiez que le trajet est encore ouvert, que la capacité suffit et que votre profil est complet.';
    if (/Invalid login/i.test(m)) return 'Email ou mot de passe incorrect.';
    if (/already registered/i.test(m)) return 'Un compte existe déjà avec cet email.';
    if (/Password should be/i.test(m)) return 'Mot de passe trop court (6 caractères minimum).';
    if (/Email not confirmed/i.test(m)) return 'Confirmez votre email avant de vous connecter (lien reçu par mail).';
    if (/duplicate key/i.test(m)) return 'Vous avez déjà fait cette action.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Connexion impossible. Vérifiez votre réseau.';
    return m;
  }

  async function withBusy(form, fn) {
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Un instant…'; }
    try { await fn(); } catch (err) { console.error(err); toast(friendly(err), 'error'); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
  }

  function openModal(html) { modal.innerHTML = `<div class="sheet">${html}</div>`; if (!modal.open) modal.showModal(); }
  function closeModal() { if (modal.open) modal.close(); }
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const verifiedBadge = () => `<span class="badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Voyageur vérifié</span>`;
  const stars = (avg, count) => count
    ? `<span class="rating" title="${avg} sur 5"><span class="star">★</span> ${Number(avg).toFixed(1)} <small>(${count})</small></span>`
    : `<span class="rating none">Pas encore noté</span>`;
  const tier = (n) => (n >= 20 ? 'Voyageur de confiance' : n >= 5 ? 'Voyageur confirmé' : n >= 1 ? 'Voyageur' : 'Nouveau voyageur');
  const statusPill = (s) => `<span class="pill ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

  async function ratingsFor(ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return {};
    const { data } = await sb.from('user_ratings').select('*').in('user_id', uniq);
    return Object.fromEntries((data || []).map((r) => [r.user_id, r]));
  }

  /* Le trajet dessiné comme un pont entre deux rives */
  function routeBlock(t, detailed = false) {
    const m = MODES[t.transport_mode] || MODES.voiture;
    const sub = (country, point) => `${esc(countryName(country))}${detailed && point ? ` — ${esc(point)}` : ''}`;
    return `<div class="route">
      <div class="stop"><b>${esc(t.origin_city)}</b><small>${sub(t.origin_country, t.origin_point)}</small></div>
      <div class="arcwrap"><svg viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true">
        <path d="M4 28 Q60 -14 116 28" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <circle cx="4" cy="28" r="3.5" fill="currentColor"/><circle cx="116" cy="28" r="3.5" fill="currentColor"/></svg>
        <span class="mode" title="${m.label}">${m.icon}</span></div>
      <div class="stop end"><b>${esc(t.dest_city)}</b><small>${sub(t.dest_country, t.dest_point)}</small></div>
    </div>`;
  }

  function tripCard(t, rmap) {
    const r = rmap[t.driver?.id];
    return `<a class="card trip" href="#/trip/${t.id}">
      ${routeBlock(t)}
      <div class="facts">
        <span>${fmtDate(t.departure_at)}</span>
        <span>${kg(t.remaining_kg)} disponibles</span>
        <span class="price">${money(t.price_per_kg, t.currency)} / kg</span>
      </div>
      <div class="who"><span>${esc(t.driver?.full_name || 'Voyageur')}</span>
        ${t.driver?.is_verified_driver ? verifiedBadge() : ''} ${stars(r?.avg_as_driver, r?.count_as_driver)}</div>
    </a>`;
  }

  function requireAuth() {
    if (S.session) return true;
    S.next = location.hash || '#/';
    location.hash = '#/auth';
    return false;
  }

  const setMain = (html) => { main.innerHTML = html; window.scrollTo(0, 0); };
  const skeleton = () => '<p class="muted">Chargement…</p>';
  const errorBox = (e) => `<div class="notice warn"><h2>Oups</h2><p>${esc(friendly(e))}</p></div>`;

  /* ------------------------------------------------------------------ */
  /* Thème                                                              */
  /* ------------------------------------------------------------------ */
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cb-theme', next); } catch (e) { /* stockage indisponible */ }
  }

  /* ------------------------------------------------------------------ */
  /* Charte                                                             */
  /* ------------------------------------------------------------------ */
  function charterHTML() {
    return `<div class="charter"><h2>${esc(CH.title)}</h2><p class="muted">${esc(CH.intro)}</p>
      ${CH.sections.map((s) => `<h3>${esc(s.title)}</h3><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
      <p class="muted" style="margin-top:14px"><small>Version ${esc(CH.version)}</small></p></div>`;
  }
  const openCharter = () => openModal(`${charterHTML()}<button class="btn block" data-act="close-modal" style="margin-top:12px">Fermer</button>`);

  /* ------------------------------------------------------------------ */
  /* Session                                                            */
  /* ------------------------------------------------------------------ */
  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    S.session = session;
    if (!session) { S.profile = null; S.traveler = null; return; }
    const [p, d] = await Promise.all([
      sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      sb.from('driver_profiles').select('*').eq('user_id', session.user.id).maybeSingle()
    ]);
    S.profile = p.data; S.traveler = d.data;
  }

  function renderShell() {
    const link = document.getElementById('user-link');
    if (S.session) {
      const name = (S.profile?.full_name || S.session.user.email || '?').trim();
      link.textContent = name.split(' ')[0];
      link.href = '#/profile';
    } else { link.textContent = 'Connexion'; link.href = '#/auth'; }
  }

  function setActiveTab(hash) {
    const key = /^#\/publish/.test(hash) ? 'publish' : /^#\/mine|^#\/chat/.test(hash) ? 'mine' : /^#\/mytrips/.test(hash) ? 'mytrips' : /^#\/profile|^#\/auth/.test(hash) ? 'profile' : 'search';
    document.querySelectorAll('.tabbar a').forEach((a) => (a.dataset.tab === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  }

  /* ------------------------------------------------------------------ */
  /* Routeur                                                            */
  /* ------------------------------------------------------------------ */
  const routes = [
    [/^#\/?$/, viewSearch],
    [/^#\/trip\/([\w-]+)$/, viewTrip],
    [/^#\/publish$/, viewPublish],
    [/^#\/mine$/, viewMine],
    [/^#\/mytrips$/, viewMyTrips],
    [/^#\/chat\/([\w-]+)$/, viewChat],
    [/^#\/profile$/, viewProfile],
    [/^#\/auth$/, viewAuth]
  ];

  function cleanupChat() { if (S.chatChannel) { sb.removeChannel(S.chatChannel); S.chatChannel = null; } S.seen = new Set(); }

  async function route() {
    cleanupChat();
    const hash = location.hash || '#/';
    setActiveTab(hash);
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (m) {
        try { await fn(...m.slice(1)); } catch (e) { console.error(e); setMain(errorBox(e)); }
        return;
      }
    }
    location.hash = '#/';
  }

  /* ------------------------------------------------------------------ */
  /* Vue : recherche de trajets                                         */
  /* ------------------------------------------------------------------ */
  async function viewSearch() {
    const f = S.filters;
    setMain(`
      <section class="hero">
        <h1>Vos colis voyagent avec ceux qui font déjà la route</h1>
        <p>Voyageurs en voiture, fourgon, avion, bus ou bateau, depuis et vers la France : trouvez de la place, réservez, notez après livraison.</p>
        <p><small>Pays desservis : ${esc(foreign().map((c) => c.name).join(', '))}</small></p>
      </section>
      <details class="filter-wrap" ${Object.values(f).some(Boolean) || matchMedia('(min-width: 720px)').matches ? 'open' : ''}>
      <summary>Filtrer les trajets</summary>
      <form class="filters" data-form="search">
        <div><label for="f-dir">Sens</label><select id="f-dir" name="dir">
          <option value="">Tous</option><option value="out" ${f.dir === 'out' ? 'selected' : ''}>Départ de France</option>
          <option value="back" ${f.dir === 'back' ? 'selected' : ''}>Arrivée en France</option></select></div>
        <div><label for="f-country">Pays</label><select id="f-country" name="country">
          <option value="">Tous</option>${countryOptions(f.country)}</select></div>
        <div><label for="f-mode">Transport</label><select id="f-mode" name="mode"><option value="">Tous</option>${opts(MODES, f.mode)}</select></div>
        <div><label for="f-date">À partir du</label><input id="f-date" type="date" name="date" value="${esc(f.date)}"></div>
        <div class="wide"><label for="f-city">Ville</label><input id="f-city" name="city" list="dl-all" placeholder="Marseille, Alger…" value="${esc(f.city)}" autocomplete="off"></div>
        <div class="wide"><button class="btn block" type="submit">Rechercher</button></div>
        <datalist id="dl-all">${cityOptions(Object.values(CITIES).flat())}</datalist>
      </form></details>
      <div id="results" class="stack" aria-live="polite">${skeleton()}</div>`);
    await loadResults();
  }

  async function loadResults() {
    const f = S.filters;
    const box = document.getElementById('results');
    if (!box) return;
    let q = sb.from('trips')
      .select('*, driver:profiles!driver_id(id, full_name, is_verified_driver, deliveries_count)')
      .eq('status', 'open').gte('departure_at', new Date().toISOString()).order('departure_at').limit(100);
    if (f.dir === 'out') q = q.eq('origin_country', 'FR');
    if (f.dir === 'back') q = q.eq('dest_country', 'FR');
    if (f.mode) q = q.eq('transport_mode', f.mode);
    if (f.date) q = q.gte('departure_at', new Date(f.date + 'T00:00').toISOString());
    const { data, error } = await q;
    if (error) { box.innerHTML = errorBox(error); return; }
    let trips = data || [];
    if (f.country) trips = trips.filter((t) => t.origin_country === f.country || t.dest_country === f.country);
    if (f.city) { const c = norm(f.city); trips = trips.filter((t) => norm(t.origin_city).includes(c) || norm(t.dest_city).includes(c)); }
    if (!trips.length) {
      box.innerHTML = `<div class="card empty"><h3>Aucun trajet pour ces critères</h3>
        <p>Élargissez la recherche, ou publiez votre propre trajet si vous voyagez bientôt.</p>
        <a class="btn" href="#/publish">Publier un trajet</a></div>`;
      return;
    }
    const rmap = await ratingsFor(trips.map((t) => t.driver?.id));
    box.innerHTML = trips.map((t) => tripCard(t, rmap)).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Vue : détail d'un trajet + réservation                             */
  /* ------------------------------------------------------------------ */
  async function viewTrip(id) {
    setMain(skeleton());
    const { data: t, error } = await sb.from('trips')
      .select('*, driver:profiles!driver_id(id, full_name, city, is_verified_driver, deliveries_count)').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!t) { setMain('<div class="card empty"><h3>Trajet introuvable</h3><a class="btn" href="#/">Voir les trajets</a></div>'); return; }
    const rmap = await ratingsFor([t.driver.id]);
    const r = rmap[t.driver.id];
    const { data: reviews } = await sb.from('ratings').select('stars, comment, created_at')
      .eq('ratee_id', t.driver.id).eq('rater_role', 'client').order('created_at', { ascending: false }).limit(5);
    const mode = MODES[t.transport_mode] || MODES.voiture;
    const isOwner = uid() === t.driver_id;
    const canBook = t.status === 'open' && !isOwner;

    let action;
    if (!canBook) {
      action = `<div class="notice">${isOwner ? 'C’est votre trajet. Gérez les demandes depuis « Mes trajets ».' : `Ce trajet n’accepte plus de réservation (${TRIP_STATUS[t.status] || t.status}).`}</div>`;
    } else if (!S.session) {
      action = `<div class="card"><h3>Réserver de la place</h3><p class="muted">Connectez-vous pour envoyer une demande à ce voyageur.</p>
        <a class="btn block" href="#/auth" data-act="remember-next" data-id="#/trip/${t.id}">Se connecter pour réserver</a></div>`;
    } else {
      action = `<form class="card" data-form="reserve" data-trip="${t.id}" data-price="${t.price_per_kg}" data-cur="${t.currency}">
        <h3>Réserver de la place</h3>
        <div class="two">
          <div class="field"><label for="r-w">Poids (kg)</label><input id="r-w" name="weight_kg" type="number" min="0.5" max="${t.remaining_kg}" step="0.5" required>
            <small>Maximum ${kg(t.remaining_kg)}</small></div>
          <div class="field"><label for="r-c">Catégorie</label><select id="r-c" name="content_category" required>${opts(CATEGORIES)}</select></div>
        </div>
        <div class="field"><label for="r-d">Contenu du colis</label>
          <textarea id="r-d" name="content_description" minlength="5" maxlength="500" required placeholder="Ex. : 3 pulls, 2 pantalons et des chaussures d’enfant"></textarea>
          <small>Le voyageur pourra vérifier ce contenu avant de prendre le colis.</small></div>
        <div class="two">
          <div class="field"><label for="r-n">Nom du destinataire</label><input id="r-n" name="recipient_name" required autocomplete="off"></div>
          <div class="field"><label for="r-p">Téléphone du destinataire</label><input id="r-p" name="recipient_phone" type="tel" required autocomplete="off"></div>
        </div>
        <p class="muted" id="estimate"><small>Prix indicatif : saisissez un poids.</small></p>
        <label class="check"><input type="checkbox" name="charter" required><span>J’ai lu et j’accepte la <button type="button" class="linkbtn" data-act="open-charter">charte d’utilisation</button>. Mon colis ne contient rien d’interdit.</span></label>
        <label class="check"><input type="checkbox" name="inspection" required><span>J’accepte que le voyageur vérifie le contenu du colis avant de le prendre en charge.</span></label>
        <button class="btn block" type="submit">Envoyer la demande</button>
        <ol class="steps"><li>Le voyageur accepte ou refuse votre demande.</li><li>Vous remettez le colis, contenu vérifié.</li>
          <li>Votre destinataire donne votre code de remise au voyageur à la livraison.</li></ol>
      </form>`;
    }

    setMain(`
      <a href="#/" class="muted">← Retour aux trajets</a>
      <div class="stack" style="margin-top:10px">
        <div class="card">${routeBlock(t, true)}
          <dl class="kv">
            <dt>Départ</dt><dd>${fmtDate(t.departure_at)}</dd>
            ${t.arrival_at ? `<dt>Arrivée</dt><dd>${fmtDate(t.arrival_at)}</dd>` : ''}
            <dt>Transport</dt><dd>${mode.icon} ${mode.label}</dd>
            <dt>Place restante</dt><dd>${kg(t.remaining_kg)} sur ${kg(t.capacity_kg)}</dd>
            <dt>Prix indicatif</dt><dd><b>${money(t.price_per_kg, t.currency)} / kg</b>, à régler directement au voyageur</dd>
            ${t.max_item_size ? `<dt>Taille max.</dt><dd>${esc(t.max_item_size)}</dd>` : ''}
          </dl>
          ${t.notes ? `<p>${esc(t.notes)}</p>` : ''}
        </div>
        <div class="card">
          <div class="row between"><h3>${esc(t.driver.full_name || 'Voyageur')}</h3>${t.driver.is_verified_driver ? verifiedBadge() : ''}</div>
          <p class="muted">${tier(t.driver.deliveries_count)}, ${t.driver.deliveries_count} livraison${t.driver.deliveries_count > 1 ? 's' : ''} sur Colibridge</p>
          <p>${stars(r?.avg_as_driver, r?.count_as_driver)}</p>
          ${(reviews || []).filter((v) => v.comment).map((v) => `<p class="muted"><small>${'★'.repeat(v.stars)} — ${esc(v.comment)}</small></p>`).join('')}
          ${S.session && !isOwner ? `<button class="linkbtn" data-act="report" data-user="${t.driver.id}"><small>Signaler ce voyageur</small></button>` : ''}
        </div>
        ${action}
      </div>`);
  }

  /* ------------------------------------------------------------------ */
  /* Vue : publier un trajet                                            */
  /* ------------------------------------------------------------------ */
  async function viewPublish() {
    if (!requireAuth()) return;
    const tp = S.traveler;
    const dl = `<datalist id="dl-fr">${cityOptions(citiesOf(HOME))}</datalist><datalist id="dl-ext"></datalist>`;
    setMain(`
      <h1>Publier un trajet</h1>
      <p class="muted">Vous voyagez bientôt depuis ou vers la France ? Proposez la place qu’il vous reste.</p>
      ${!tp ? `<div class="notice warn">Complétez d’abord votre <a href="#/profile">profil voyageur</a> (pièce d’identité, et plaque + permis si vous roulez). Vous pourrez ensuite publier.</div>` : ''}
      <form class="card" data-form="publish">
        <div class="two dates">
          <div class="field"><label for="p-mode">Transport</label><select id="p-mode" name="transport_mode" required>${opts(MODES)}</select></div>
          <div class="field"><label for="p-dir">Sens</label><select id="p-dir" name="dir"><option value="out">Départ de France</option><option value="back">Arrivée en France</option></select></div>
        </div>
        <div class="field" id="p-cwrap"><label for="p-country" id="p-cl">Pays de destination</label><select id="p-country" name="country">${countryOptions()}</select></div>
        <div class="two">
          <div class="field"><label for="p-oc" id="p-oc-l">Ville de départ</label><input id="p-oc" name="origin_city" list="dl-fr" required autocomplete="off"></div>
          <div class="field"><label for="p-dc" id="p-dc-l">Ville d’arrivée</label><input id="p-dc" name="dest_city" list="dl-ext" required autocomplete="off"></div>
        </div>
        <div class="two">
          <div class="field"><label for="p-op">Point de rendez-vous au départ</label><input id="p-op" name="origin_point" placeholder="Gare, port, aéroport…"></div>
          <div class="field"><label for="p-dp">Point de remise à l’arrivée</label><input id="p-dp" name="dest_point" placeholder="Port d’Alger, aéroport…"></div>
        </div>
        <div class="two dates">
          <div class="field"><label for="p-dep">Départ</label><input id="p-dep" type="datetime-local" name="departure_at" min="${localISO()}" required></div>
          <div class="field"><label for="p-arr">Arrivée (facultatif)</label><input id="p-arr" type="datetime-local" name="arrival_at" min="${localISO()}"></div>
        </div>
        <div class="two">
          <div class="field"><label for="p-cap">Place disponible (kg)</label><input id="p-cap" name="capacity_kg" type="number" min="1" max="2000" step="0.5" required></div>
          <div class="field"><label for="p-pr">Prix par kg</label><input id="p-pr" name="price_per_kg" type="number" min="0" step="0.5" required></div>
        </div>
        <div class="two">
          <div class="field"><label for="p-cur">Devise</label><select id="p-cur" name="currency">${currencies().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
          <div class="field"><label for="p-size">Taille maximale d’un colis</label><input id="p-size" name="max_item_size" placeholder="Ex. : 80 cm"></div>
        </div>
        <div class="field"><label for="p-notes">Informations utiles</label><textarea id="p-notes" name="notes" maxlength="600" placeholder="Horaires de remise, lieu de rendez-vous, conditions…"></textarea></div>
        <label class="check"><input type="checkbox" name="charter" required><span>J’ai lu et j’accepte la <button type="button" class="linkbtn" data-act="open-charter">charte d’utilisation</button>. Je vérifierai le contenu de chaque colis et je peux en refuser un.</span></label>
        <button class="btn block" type="submit" ${tp ? '' : 'disabled'}>Publier le trajet</button>
      </form>${dl}`);
    syncPublishDir();
  }

  function syncPublishDir() {
    const dir = document.getElementById('p-dir');
    if (!dir) return;
    const out = dir.value === 'out';
    document.getElementById('dl-ext').innerHTML = cityOptions(citiesOf(document.getElementById('p-country').value));
    document.getElementById('p-oc').setAttribute('list', out ? 'dl-fr' : 'dl-ext');
    document.getElementById('p-dc').setAttribute('list', out ? 'dl-ext' : 'dl-fr');
    document.getElementById('p-cl').textContent = out ? 'Pays de destination' : 'Pays de départ';
  }

  /* ------------------------------------------------------------------ */
  /* Vue : mes envois (côté client)                                     */
  /* ------------------------------------------------------------------ */
  async function viewMine() {
    if (!requireAuth()) return;
    setMain(`<h1>Mes envois</h1>${skeleton()}`);
    const { data: list, error } = await sb.from('reservations')
      .select('*, trip:trips(*, driver:profiles!driver_id(id, full_name, is_verified_driver))')
      .eq('client_id', uid()).order('created_at', { ascending: false });
    if (error) throw error;
    const ids = (list || []).map((r) => r.id);
    const [sec, rated] = ids.length ? await Promise.all([
      sb.from('reservation_secrets').select('reservation_id, delivery_code').in('reservation_id', ids),
      sb.from('ratings').select('reservation_id').eq('rater_id', uid())
    ]) : [{ data: [] }, { data: [] }];
    const codes = Object.fromEntries((sec.data || []).map((s) => [s.reservation_id, s.delivery_code]));
    const doneRatings = new Set((rated.data || []).map((x) => x.reservation_id));

    if (!list.length) {
      setMain(`<h1>Mes envois</h1><div class="card empty"><h3>Aucun envoi pour l’instant</h3><p>Trouvez un voyageur sur votre route et réservez de la place.</p><a class="btn" href="#/">Voir les trajets</a></div>`);
      return;
    }
    setMain(`<h1>Mes envois</h1><div class="stack">${list.map((r) => {
      const t = r.trip, d = t.driver;
      const showCode = ['accepted', 'picked_up'].includes(r.status) && codes[r.id];
      return `<article class="card">
        ${routeBlock(t)}
        <div class="row between"><span class="muted"><small>${fmtDate(t.departure_at)}</small></span>${statusPill(r.status)}</div>
        <dl class="kv"><dt>Voyageur</dt><dd>${esc(d.full_name || 'Voyageur')} ${d.is_verified_driver ? verifiedBadge() : ''}</dd>
          <dt>Colis</dt><dd>${kg(r.weight_kg)}, ${esc(CATEGORIES[r.content_category])}</dd>
          <dt>Contenu</dt><dd>${esc(r.content_description)}</dd>
          <dt>Destinataire</dt><dd>${esc(r.recipient_name)}, ${esc(r.recipient_phone)}</dd>
          <dt>Prix indicatif</dt><dd>${money(r.weight_kg * t.price_per_kg, t.currency)}, à régler au voyageur</dd></dl>
        ${showCode ? `<div class="code-box"><small>Code de remise</small><div class="code">${esc(codes[r.id])}</div>
          <p>Donnez ce code à votre destinataire. Il ne le communique au voyageur qu’à la réception du colis.</p></div>` : ''}
        ${r.status === 'accepted' ? '<div class="notice">Présentez le colis ouvert au voyageur : il peut en vérifier le contenu et le refuser.</div>' : ''}
        <div class="row res-block">
          <a class="btn small secondary" href="#/chat/${r.id}">Message</a>
          ${['pending', 'accepted'].includes(r.status) ? `<button class="btn small danger" data-act="cancel-res" data-id="${r.id}">Annuler</button>` : ''}
          ${r.status === 'delivered' && !doneRatings.has(r.id) ? `<button class="btn small" data-act="rate" data-id="${r.id}" data-ratee="${d.id}" data-role="client" data-name="${esc(d.full_name)}">Noter le voyageur</button>` : ''}
          ${r.status === 'delivered' && doneRatings.has(r.id) ? '<small class="muted">Merci pour votre note</small>' : ''}
          <button class="linkbtn" data-act="report" data-user="${d.id}" data-id="${r.id}"><small>Signaler</small></button>
        </div></article>`;
    }).join('')}</div>`);
  }

  /* ------------------------------------------------------------------ */
  /* Vue : mes trajets (côté voyageur)                                  */
  /* ------------------------------------------------------------------ */
  async function viewMyTrips() {
    if (!requireAuth()) return;
    setMain(`<h1>Mes trajets</h1>${skeleton()}`);
    const { data: trips, error } = await sb.from('trips').select('*').eq('driver_id', uid()).order('departure_at', { ascending: false });
    if (error) throw error;
    if (!trips.length) {
      setMain(`<h1>Mes trajets</h1><div class="card empty"><h3>Vous n’avez publié aucun trajet</h3><p>Vous voyagez bientôt ? Proposez la place qu’il vous reste.</p><a class="btn" href="#/publish">Publier un trajet</a></div>`);
      return;
    }
    const ids = trips.map((t) => t.id);
    const { data: resv } = await sb.from('reservations')
      .select('*, client:profiles!client_id(id, full_name)').in('trip_id', ids).order('created_at');
    const rated = await sb.from('ratings').select('reservation_id').eq('rater_id', uid());
    const doneRatings = new Set((rated.data || []).map((x) => x.reservation_id));
    const rmap = await ratingsFor((resv || []).map((r) => r.client?.id));

    setMain(`<h1>Mes trajets</h1><div class="stack">${trips.map((t) => {
      const rs = (resv || []).filter((r) => r.trip_id === t.id);
      return `<article class="card">${routeBlock(t)}
        <div class="row between">
          <small class="muted">${fmtDate(t.departure_at)}, ${kg(t.remaining_kg)} libres sur ${kg(t.capacity_kg)}</small>
          <select data-change="trip-status" data-id="${t.id}" aria-label="Statut du trajet" style="width:auto;min-height:38px">
            ${Object.entries(TRIP_STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''} ${k === 'full' ? 'disabled' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        ${rs.length ? rs.map((r) => resRow(r, rmap, doneRatings)).join('') : '<p class="muted res-block"><small>Aucune demande pour ce trajet.</small></p>'}
      </article>`;
    }).join('')}</div>`);
  }

  function resRow(r, rmap, doneRatings) {
    const cr = rmap[r.client?.id];
    let actions = '';
    if (r.status === 'pending') {
      actions = `<div class="notice warn"><small>Vérifiez le contenu avec l’expéditeur avant d’accepter. Vous pouvez refuser tout colis.</small></div>
        <button class="btn small" data-act="accept-res" data-id="${r.id}">Accepter</button>
        <button class="btn small danger" data-act="refuse-res" data-id="${r.id}">Refuser</button>`;
    } else if (r.status === 'accepted') {
      actions = `<button class="btn small" data-act="pickup-res" data-id="${r.id}">J’ai récupéré le colis</button>
        <button class="btn small danger" data-act="cancel-res" data-id="${r.id}">Annuler</button>`;
    } else if (r.status === 'picked_up') {
      actions = `<form class="row grow" data-form="deliver" data-id="${r.id}">
        <input name="code" inputmode="numeric" pattern="\\d{6}" maxlength="6" placeholder="Code à 6 chiffres" required style="width:170px" aria-label="Code de remise donné par le destinataire">
        <button class="btn small" type="submit">Confirmer la livraison</button></form>`;
    } else if (r.status === 'delivered' && !doneRatings.has(r.id)) {
      actions = `<button class="btn small" data-act="rate" data-id="${r.id}" data-ratee="${r.client.id}" data-role="driver" data-name="${esc(r.client.full_name)}">Noter l’expéditeur</button>`;
    }
    return `<div class="res-block">
      <div class="row between"><b>${esc(r.client?.full_name || 'Expéditeur')}</b>${statusPill(r.status)}</div>
      <div class="muted"><small>${stars(cr?.avg_as_client, cr?.count_as_client)}</small></div>
      <dl class="kv"><dt>Colis</dt><dd>${kg(r.weight_kg)}, ${esc(CATEGORIES[r.content_category])}</dd>
        <dt>Contenu déclaré</dt><dd>${esc(r.content_description)}</dd>
        <dt>Destinataire</dt><dd>${esc(r.recipient_name)}, ${esc(r.recipient_phone)}</dd></dl>
      <div class="row">${actions}
        <a class="btn small secondary" href="#/chat/${r.id}">Message</a>
        <button class="linkbtn" data-act="report" data-user="${r.client?.id}" data-id="${r.id}"><small>Signaler</small></button></div>
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Vue : chat par réservation (temps réel)                            */
  /* ------------------------------------------------------------------ */
  function appendMessage(m) {
    if (S.seen.has(m.id)) return;
    S.seen.add(m.id);
    const box = document.getElementById('msgs');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'msg' + (m.sender_id === uid() ? ' mine' : '');
    div.innerHTML = `${esc(m.body)}<time>${fmtTime(m.created_at)}</time>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  async function viewChat(id) {
    if (!requireAuth()) return;
    setMain(skeleton());
    const { data: r, error } = await sb.from('reservations')
      .select('*, client:profiles!client_id(id, full_name), trip:trips(*, driver:profiles!driver_id(id, full_name))').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!r) { setMain('<div class="card empty"><h3>Conversation introuvable</h3></div>'); return; }
    const other = r.client_id === uid() ? r.trip.driver : r.client;
    const { data: msgs } = await sb.from('messages').select('*').eq('reservation_id', id).order('created_at');
    const back = r.client_id === uid() ? '#/mine' : '#/mytrips';
    setMain(`
      <a href="${back}" class="muted">← Retour</a>
      <div class="row between" style="margin:8px 0 4px"><h2 style="margin:0">${esc(other.full_name || 'Utilisateur')}</h2>${statusPill(r.status)}</div>
      <p class="muted"><small>${esc(r.trip.origin_city)} → ${esc(r.trip.dest_city)}, ${fmtDate(r.trip.departure_at)}. Le prix se règle directement entre vous.</small></p>
      <div class="chat"><div class="msgs" id="msgs" aria-live="polite"></div>
        <form class="composer" data-form="message" data-id="${id}">
          <input name="body" placeholder="Votre message" maxlength="2000" autocomplete="off" aria-label="Votre message" required>
          <button class="btn" type="submit">Envoyer</button></form></div>`);
    (msgs || []).forEach(appendMessage);
    S.chatChannel = sb.channel('chat-' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `reservation_id=eq.${id}` }, (p) => appendMessage(p.new))
      .subscribe();
  }

  /* ------------------------------------------------------------------ */
  /* Vue : profil                                                       */
  /* ------------------------------------------------------------------ */
  async function viewProfile() {
    if (!requireAuth()) return;
    setMain(skeleton());
    await loadMe();
    const p = S.profile || {}, tp = S.traveler;
    const rmap = await ratingsFor([uid()]);
    const r = rmap[uid()];
    const vs = { pending: ['En cours de vérification', 'warn'], verified: ['Vérifié', 'done'], rejected: ['Refusé, corrigez vos informations', 'off'] };
    setMain(`
      <h1>Mon profil</h1>
      <div class="stack">
        <div class="card">
          <div class="stats">
            <div class="stat"><b>${p.deliveries_count || 0}</b><small>livraison${(p.deliveries_count || 0) > 1 ? 's' : ''} effectuée${(p.deliveries_count || 0) > 1 ? 's' : ''}</small></div>
            <div class="stat"><b>${tier(p.deliveries_count || 0)}</b>${p.is_verified_driver ? verifiedBadge() : '<small>Badge vérifié : après contrôle de votre profil voyageur</small>'}</div>
          </div>
          <p style="margin-top:10px">Comme voyageur : ${stars(r?.avg_as_driver, r?.count_as_driver)}<br>Comme expéditeur : ${stars(r?.avg_as_client, r?.count_as_client)}</p>
        </div>

        <form class="card" data-form="profile">
          <h3>Mes informations</h3>
          <div class="field"><label for="u-n">Nom affiché</label><input id="u-n" name="full_name" value="${esc(p.full_name)}" required maxlength="80"></div>
          <div class="two">
            <div class="field"><label for="u-c">Ville</label><input id="u-c" name="city" value="${esc(p.city)}"></div>
            <div class="field"><label for="u-p">Pays</label><select id="u-p" name="country"><option value="">—</option>${opts(COUNTRIES, p.country)}</select></div>
          </div>
          <button class="btn block" type="submit">Enregistrer</button>
        </form>

        <form class="card" data-form="traveler">
          <div class="row between"><h3>Profil voyageur</h3>${tp ? `<span class="pill ${vs[tp.verification_status][1]}">${vs[tp.verification_status][0]}</span>` : ''}</div>
          <p class="muted"><small>Nécessaire pour publier un trajet. Ces informations sont privées : seule l’équipe Colibridge les consulte pour vérifier votre identité.</small></p>
          <div class="field"><label for="t-id">Pièce d’identité (photo ou PDF)</label><input id="t-id" type="file" name="doc" accept="image/*,application/pdf">
            <small>${tp?.id_document_path ? 'Un document est déjà enregistré. Choisissez-en un autre pour le remplacer.' : 'Obligatoire pour être vérifié.'}</small></div>
          <p class="muted"><small>Si vous voyagez en voiture, fourgon ou camionnette :</small></p>
          <div class="two">
            <div class="field"><label for="t-pl">Plaque d’immatriculation</label><input id="t-pl" name="plate" value="${esc(tp?.plate)}" autocomplete="off"></div>
            <div class="field"><label for="t-li">Numéro de permis</label><input id="t-li" name="license_number" value="${esc(tp?.license_number)}" autocomplete="off"></div>
          </div>
          <div class="field"><label for="t-m">Véhicule (marque, modèle)</label><input id="t-m" name="vehicle_model" value="${esc(tp?.vehicle_model)}"></div>
          <button class="btn block" type="submit">Enregistrer mon profil voyageur</button>
        </form>

        <div class="card stack">
          <button class="btn secondary" data-act="open-charter">Lire la charte d’utilisation</button>
          <button class="btn secondary" data-act="toggle-theme">Changer de thème</button>
          <button class="btn danger" data-act="logout">Se déconnecter</button>
        </div>
      </div>`);
  }

  /* ------------------------------------------------------------------ */
  /* Vue : connexion / inscription                                      */
  /* ------------------------------------------------------------------ */
  function viewAuth() {
    if (S.session) { location.hash = '#/profile'; return; }
    const login = S.authTab === 'login';
    setMain(`
      <h1>${login ? 'Connexion' : 'Créer un compte'}</h1>
      <p class="muted">Un seul compte pour envoyer des colis et pour proposer de la place.</p>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="${login}" data-act="auth-tab" data-id="login">Connexion</button>
        <button role="tab" aria-selected="${!login}" data-act="auth-tab" data-id="signup">Inscription</button>
      </div>
      <form class="card" data-form="${login ? 'login' : 'signup'}">
        ${login ? '' : '<div class="field"><label for="a-n">Nom affiché</label><input id="a-n" name="full_name" required maxlength="80" autocomplete="name"></div>'}
        <div class="field"><label for="a-e">Email</label><input id="a-e" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="a-p">Mot de passe</label><input id="a-p" name="password" type="password" minlength="6" required autocomplete="${login ? 'current-password' : 'new-password'}"></div>
        ${login ? '' : `<label class="check"><input type="checkbox" name="charter" required><span>J’ai lu et j’accepte la <button type="button" class="linkbtn" data-act="open-charter">charte d’utilisation</button>.</span></label>`}
        <button class="btn block" type="submit">${login ? 'Se connecter' : 'Créer mon compte'}</button>
      </form>`);
  }

  /* ------------------------------------------------------------------ */
  /* Modales : notation et signalement                                  */
  /* ------------------------------------------------------------------ */
  function openRate(el) {
    openModal(`<form data-form="rate" data-id="${el.dataset.id}" data-ratee="${el.dataset.ratee}" data-role="${el.dataset.role}">
      <h2>Noter ${esc(el.dataset.name || 'cet utilisateur')}</h2>
      <p class="muted">Votre note est visible sur son profil.</p>
      <div class="stars-input" role="radiogroup" aria-label="Note sur 5">
        ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="stars" id="st${n}" value="${n}" ${n === 5 ? 'required' : ''}><label for="st${n}" title="${n} sur 5">★</label>`).join('')}
      </div>
      <div class="field"><label for="rc">Commentaire (facultatif)</label><textarea id="rc" name="comment" maxlength="500"></textarea></div>
      <div class="row"><button class="btn grow" type="submit">Envoyer ma note</button><button class="btn secondary" type="button" data-act="close-modal">Annuler</button></div></form>`);
  }

  function openReport(el) {
    openModal(`<form data-form="report" data-user="${el.dataset.user || ''}" data-id="${el.dataset.id || ''}">
      <h2>Signaler</h2><p class="muted">Un colis suspect, un comportement inquiétant, une arnaque ? L’équipe examine chaque signalement.</p>
      <div class="field"><label for="rr">Motif</label><select id="rr" name="reason" required>${opts(REPORT_REASONS)}</select></div>
      <div class="field"><label for="rd">Détails</label><textarea id="rd" name="details" maxlength="1000" placeholder="Que s’est-il passé ?"></textarea></div>
      <div class="row"><button class="btn grow" type="submit">Envoyer le signalement</button><button class="btn secondary" type="button" data-act="close-modal">Annuler</button></div></form>`);
  }

  /* ------------------------------------------------------------------ */
  /* Actions (clics)                                                    */
  /* ------------------------------------------------------------------ */
  async function setResStatus(id, status, message) {
    const { error } = await sb.from('reservations').update({ status }).eq('id', id);
    if (error) throw error;
    toast(message);
    route();
  }

  const actions = {
    'open-charter': openCharter,
    'close-modal': closeModal,
    'toggle-theme': toggleTheme,
    'remember-next': (el) => { S.next = el.dataset.id; },
    'auth-tab': (el) => { S.authTab = el.dataset.id; viewAuth(); },
    logout: async () => { await sb.auth.signOut(); },
    'accept-res': (el) => setResStatus(el.dataset.id, 'accepted', 'Demande acceptée'),
    'refuse-res': (el) => confirm('Refuser cette demande ?') && setResStatus(el.dataset.id, 'refused', 'Demande refusée'),
    'pickup-res': (el) => setResStatus(el.dataset.id, 'picked_up', 'Colis marqué comme récupéré'),
    'cancel-res': (el) => confirm('Annuler cette réservation ?') && setResStatus(el.dataset.id, 'cancelled', 'Réservation annulée'),
    rate: openRate,
    report: openReport
  };

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    try { await fn(el, e); } catch (err) { console.error(err); toast(friendly(err), 'error'); }
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset?.change === 'trip-status') {
      if (el.value === 'cancelled' && !confirm('Annuler ce trajet ? Les demandes en cours resteront à traiter.')) { route(); return; }
      const { error } = await sb.from('trips').update({ status: el.value }).eq('id', el.dataset.id);
      if (error) { toast(friendly(error), 'error'); route(); return; }
      toast('Statut du trajet mis à jour');
    }
    if (el.id === 'p-dir' || el.id === 'p-country') syncPublishDir();
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.name === 'weight_kg') {
      const f = el.form, out = document.getElementById('estimate');
      const total = Number(el.value) * Number(f.dataset.price);
      if (out) out.innerHTML = total > 0 ? `<small>Prix indicatif : <b>${money(total, f.dataset.cur)}</b>, à régler directement au voyageur.</small>` : '<small>Prix indicatif : saisissez un poids.</small>';
    }
  });

  /* ------------------------------------------------------------------ */
  /* Formulaires                                                        */
  /* ------------------------------------------------------------------ */
  const forms = {
    search(f) {
      const fd = new FormData(f);
      S.filters = { dir: fd.get('dir'), country: fd.get('country'), city: fd.get('city').trim(), date: fd.get('date'), mode: fd.get('mode') };
      const box = document.getElementById('results');
      if (box) box.innerHTML = skeleton();
      return loadResults();
    },

    async login(f) {
      const fd = new FormData(f);
      const { error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') });
      if (error) throw error;
    },

    async signup(f) {
      const fd = new FormData(f);
      const { data, error } = await sb.auth.signUp({
        email: fd.get('email').trim(), password: fd.get('password'),
        options: { data: { full_name: fd.get('full_name').trim(), charter_accepted: 'true', charter_version: CH.version } }
      });
      if (error) throw error;
      if (!data.session) { toast('Compte créé. Confirmez votre email, puis connectez-vous.'); S.authTab = 'login'; viewAuth(); }
    },

    async reserve(f) {
      const fd = new FormData(f);
      const { error } = await sb.from('reservations').insert({
        trip_id: f.dataset.trip, client_id: uid(),
        weight_kg: Number(fd.get('weight_kg')), content_category: fd.get('content_category'),
        content_description: fd.get('content_description').trim(),
        recipient_name: fd.get('recipient_name').trim(), recipient_phone: fd.get('recipient_phone').trim(),
        charter_accepted: true, inspection_accepted: true, charter_version: CH.version
      });
      if (error) throw error;
      toast('Demande envoyée au voyageur');
      location.hash = '#/mine';
    },

    async publish(f) {
      const fd = new FormData(f);
      const out = fd.get('dir') === 'out';
      const mg = fd.get('country');
      const mode = fd.get('transport_mode');
      if (ROAD.includes(mode) && !(S.traveler?.plate && S.traveler?.license_number)) {
        toast('Pour un trajet en voiture, fourgon ou camionnette, renseignez plaque et permis dans votre profil voyageur.', 'error');
        return;
      }
      const dep = new Date(fd.get('departure_at'));
      const arrRaw = fd.get('arrival_at');
      const { error } = await sb.from('trips').insert({
        driver_id: uid(), transport_mode: mode,
        origin_country: out ? 'FR' : mg, dest_country: out ? mg : 'FR',
        origin_city: fd.get('origin_city').trim(), dest_city: fd.get('dest_city').trim(),
        origin_point: fd.get('origin_point').trim() || null, dest_point: fd.get('dest_point').trim() || null,
        departure_at: dep.toISOString(), arrival_at: arrRaw ? new Date(arrRaw).toISOString() : null,
        capacity_kg: Number(fd.get('capacity_kg')), price_per_kg: Number(fd.get('price_per_kg')), currency: fd.get('currency'),
        max_item_size: fd.get('max_item_size').trim() || null, notes: fd.get('notes').trim() || null,
        charter_accepted: true, charter_version: CH.version
      });
      if (error) throw error;
      toast('Trajet publié');
      location.hash = '#/mytrips';
    },

    async profile(f) {
      const fd = new FormData(f);
      const { error } = await sb.from('profiles').update({
        full_name: fd.get('full_name').trim(), city: fd.get('city').trim() || null, country: fd.get('country') || null
      }).eq('id', uid());
      if (error) throw error;
      await loadMe(); renderShell();
      toast('Profil enregistré');
    },

    async traveler(f) {
      const fd = new FormData(f);
      let path = S.traveler?.id_document_path || null;
      const file = fd.get('doc');
      if (file && file.size > 0) {
        if (file.size > 8 * 1024 * 1024) throw new Error('Document trop volumineux (8 Mo maximum).');
        const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-60);
        const target = `${uid()}/${Date.now()}-${safe}`;
        const up = await sb.storage.from('identity-docs').upload(target, file, { contentType: file.type });
        if (up.error) throw up.error;
        path = target;
      }
      const { error } = await sb.from('driver_profiles').upsert({
        user_id: uid(), id_document_path: path,
        plate: fd.get('plate').trim() || null, license_number: fd.get('license_number').trim() || null,
        vehicle_model: fd.get('vehicle_model').trim() || null
      }, { onConflict: 'user_id' });
      if (error) throw error;
      await loadMe();
      toast('Profil voyageur enregistré');
      viewProfile();
    },

    async deliver(f) {
      const code = new FormData(f).get('code').trim();
      const { data, error } = await sb.rpc('confirm_delivery', { p_reservation: f.dataset.id, p_code: code });
      if (error) throw error;
      if (data === true) { toast('Livraison confirmée. Merci !'); route(); }
      else toast('Code incorrect. Demandez-le à nouveau au destinataire.', 'error');
    },

    async rate(f) {
      const fd = new FormData(f);
      const { error } = await sb.from('ratings').insert({
        reservation_id: f.dataset.id, rater_id: uid(), ratee_id: f.dataset.ratee, rater_role: f.dataset.role,
        stars: Number(fd.get('stars')), comment: fd.get('comment').trim() || null
      });
      if (error) throw error;
      closeModal(); toast('Merci pour votre note'); route();
    },

    async report(f) {
      const fd = new FormData(f);
      const { error } = await sb.from('reports').insert({
        reporter_id: uid(), reported_user_id: f.dataset.user || null, reservation_id: f.dataset.id || null,
        reason: fd.get('reason'), details: fd.get('details').trim() || null
      });
      if (error) throw error;
      closeModal(); toast('Signalement envoyé. Merci.');
    }
  };

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const name = f.dataset.form;
    if (name === 'message') {
      const input = f.elements.body;
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      const { data, error } = await sb.from('messages').insert({ reservation_id: f.dataset.id, sender_id: uid(), body }).select().single();
      if (error) { input.value = body; toast(friendly(error), 'error'); return; }
      appendMessage(data);
      return;
    }
    if (forms[name]) withBusy(f, () => forms[name](f));
  });

  /* ------------------------------------------------------------------ */
  /* Temps réel : rafraîchit les listes quand une réservation change    */
  /* ------------------------------------------------------------------ */
  let resChannel = null, refreshTimer = null;
  function subscribeRealtime() {
    if (resChannel) { sb.removeChannel(resChannel); resChannel = null; }
    if (!S.session) return;
    resChannel = sb.channel('reservations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          if (/^#\/(mine|mytrips)$/.test(location.hash) && !document.activeElement?.matches('input, textarea')) {
            const y = window.scrollY;
            route().then(() => window.scrollTo(0, y));
          }
        }, 500);
      }).subscribe();
  }

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                          */
  /* ------------------------------------------------------------------ */
  async function loadCountries() {
    try {
      const { data, error } = await sb.from('countries').select('code, name, currency, sort').eq('active', true).order('sort');
      if (!error && data && data.length) {
        COUNTRY_LIST = data;
        COUNTRIES = Object.fromEntries(data.map((c) => [c.code, c.name]));
      }
    } catch (e) { /* on garde la liste de secours */ }
  }

  async function init() {
    await Promise.all([loadMe(), loadCountries()]);
    renderShell();
    subscribeRealtime();

    sb.auth.onAuthStateChange((event, session) => {
      const prev = S.session?.user?.id, now = session?.user?.id;
      if (prev === now) return;
      // pas d'appel Supabase directement dans ce callback : on le décale
      setTimeout(async () => {
        await loadMe(); renderShell(); subscribeRealtime();
        const target = now ? (S.next || '#/') : '#/';
        S.next = null;
        if (location.hash === target) route(); else location.hash = target;
      }, 0);
    });

    window.addEventListener('hashchange', route);
    route();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  init().catch((e) => { console.error(e); setMain(errorBox(e)); });
})();

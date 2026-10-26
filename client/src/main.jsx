import React, {
  useState,
  useEffect,
  useContext,
  createContext,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  CalendarDays,
  Clock,
  Heart,
  Menu,
  X,
  Check,
  Plus,
  Minus,
  Leaf,
  ShieldCheck,
  Users,
  Compass,
  LogOut,
  LayoutDashboard,
  Search,
  Mountain,
  ChevronDown,
  Star,
} from "lucide-react";
import { api, money, date, liveInterval, clearLiveInterval } from "./api";
import Admin from "./Admin";
import AdminRoute from "./AdminRoute";
import SiteImage from "./SiteImage";
import AuthPage from "./AuthPages";
import "./style.css";
const Context = createContext();
export const useApp = () => useContext(Context);
function App() {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    [catalog, setCatalog] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const refresh = useCallback(
    () =>
      api("/catalog")
        .then(data => { setCatalog(data); setError(""); })
        .catch((e) => { setCatalog(null); setError(e.message); }),
    [],
  );
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
    refresh();
    const timer = liveInterval(refresh, 10000);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      clearLiveInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  return (
    <Context.Provider
      value={{ user, setUser, ready, catalog, refresh, notify: setToast }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/admin/login" element={<><Header /><AuthPage mode="admin" /><Footer /></>} />
          <Route path="/admin/*" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route
            path="*"
            element={
              <>
                <Header />
                <main>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/packages" element={<Listing />} />
                    <Route path="/packages/:id" element={<Detail />} />
                    <Route path="/login" element={<AuthPage mode="login" />} />
                    <Route path="/register" element={<AuthPage mode="register" />} />
                    <Route path="/verify-email" element={<AuthPage mode="verify" />} />
                    <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
                    <Route path="/reset-password" element={<AuthPage mode="reset" />} />
                    <Route path="/auth/confirm" element={<AuthPage mode="confirm" />} />
                    <Route path="/bookings" element={<Account />} />
                    <Route path="/profile" element={<Account profile />} />
                    <Route path="/wishlist" element={<Wishlist />} />
                    <Route
                      path="*"
                      element={
                        <Empty
                          title="That path leads somewhere else."
                          text="Let’s get you back to your next adventure."
                        />
                      }
                    />
                  </Routes>
                  {error && !catalog && (
                    <div className="notice container">
                      The database is not connected yet. Follow the Atlas setup
                      in the README, then start the API.{" "}
                      <button
                        onClick={() => {
                          setError("");
                          refresh();
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </main>
                <Footer />
              </>
            }
          />
        </Routes>
        {toast && (
          <div role="status" className="toast">
            <Check size={18} />
            {toast}
          </div>
        )}
      </BrowserRouter>
    </Context.Provider>
  );
}
function Header() {
  const { user, setUser, catalog, notify } = useApp(),
    [open, setOpen] = useState(false);
  return (
    <header>
      <div className="nav container">
        <Link to="/" className="brand">
          <Compass />
          {catalog?.settings?.businessName || "Roam"}
          <span>®</span>
        </Link>
        <nav className={open ? "open" : ""} onClick={() => setOpen(false)}>
          <NavLink to="/packages">Explore tours</NavLink>
          <NavLink to="/wishlist">Wishlist</NavLink>
          <NavLink to="/bookings">My bookings</NavLink>
          {user?.role === "admin" && <NavLink to="/admin">Admin panel</NavLink>}
        </nav>
        <div className="nav-actions">
          {user ? (
            <>
              <Link className="avatar" to="/profile" title="Your profile">
                {user.name.slice(0, 1)}
              </Link>
              <button
                className="icon login-link"
                aria-label="Log out"
                title="Log out"
                onClick={async () => {
                  try {
                    await api("/auth/logout", { method: "POST" });
                    setUser(null);
                  } catch (error) {
                    if (error.status === 401) setUser(null);
                    else notify(error.message);
                  }
                }}
              >
                <LogOut size={18} />
                <span>Log out</span>
              </button>
            </>
          ) : (
            <Link to="/login" className="login-link">
              Log in <ArrowUpRight size={16} />
            </Link>
          )}
          <Link className="button small" to="/packages">
            Let’s get away <ArrowUpRight size={16} />
          </Link>
          <button
            className="icon mobile-menu"
            aria-label="Toggle menu"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
    </header>
  );
}
function Footer() {
  const { catalog } = useApp();
  return (
    <footer>
      <div className="container footer-grid">
        <div>
          <Link to="/" className="brand">
            <Compass />
            {catalog?.settings?.businessName || "Roam"}
            <span>®</span>
          </Link>
          <p>A little further. A little freer.</p>
        </div>
        <div>
          <h4>Your next chapter starts here.</h4>
          <Link to="/packages">
            Explore all journeys <ArrowUpRight size={16} />
          </Link>
        </div>
        <div>
          <h4>Let’s talk travel</h4>
          <a href={`mailto:${catalog?.settings?.email || ""}`}>
            {catalog?.settings?.email || "Connect your database"}
          </a>
          <p>{catalog?.settings?.phone}</p>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>
          © {new Date().getFullYear()}{" "}
          {catalog?.settings?.businessName || "Roam"}. Made for the journey.
        </span>
        <Link to="/admin">Agency admin</Link>
      </div>
    </footer>
  );
}
function Home() {
  const { catalog } = useApp(),
    [packages, setPackages] = useState([]),
    [index, setIndex] = useState(0),
    [destination, setDestination] = useState(""),
    [duration, setDuration] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api("/packages?featured=true")
        .then((d) => active && setPackages(d.items))
        .catch(() => active && setPackages([]));
    load();
    const t = liveInterval(load, 10000);
    return () => { active = false; clearLiveInterval(t); };
  }, []);
  const banner =
    catalog?.banners?.[index % Math.max(catalog.banners.length, 1)];
  const navigate = useNavigate();
  return (
    <>
      <section
        className="hero"
        style={
          banner?.image
            ? {
                backgroundImage: `linear-gradient(90deg,rgba(7,30,24,.65),rgba(7,30,24,.08)),url(${JSON.stringify(banner.image)})`,
              }
            : {}
        }
      >
        <div className="container hero-content">
          <span className="eyebrow light">
            <span className="tiny-line" /> SMALL GROUPS. BIG LITTLE MOMENTS.
          </span>
          <h1>{banner?.title || "Your next journey\nstarts here."}</h1>
          <p>
            {banner?.subtitle ||
              "Connect your travel collection and let the exploring begin."}
          </p>
          <Link to={banner?.link || "/packages"} className="button cream">
            {banner?.buttonText || "Explore journeys"}
            <ArrowUpRight size={19} />
          </Link>
          <div className="hero-note">
            <span className="circle-icon">
              <Leaf size={18} />
            </span>{" "}
            Less planning. More living.
          </div>
        </div>
        <div className="hero-bottom container">
          <span>GO SOMEWHERE THAT STAYS WITH YOU.</span>
          <div className="dots">
            {catalog?.banners?.map((b, i) => (
              <button
                key={b._id}
                aria-label={`Banner ${i + 1}`}
                className={i === index ? "selected" : ""}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <span>SCROLL TO EXPLORE ↓</span>
        </div>
      </section>
      <section className="container search-wrap">
        <form
          className="search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(
              `/packages?destination=${destination}&duration=${duration}`,
            );
          }}
        >
          <div className="search-label">
            <Compass size={23} />
            <strong>
              Your next
              <br />
              great escape
            </strong>
          </div>
          <label>
            <span>
              <MapPin size={15} /> WHERE TO?
            </span>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">All destinations</option>
              {catalog?.destinations?.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              <CalendarDays size={15} /> HOW LONG?
            </span>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="">Any duration</option>
              <option value="1-4">Up to 4 days</option>
              <option value="5-7">5–7 days</option>
              <option value="8-30">8+ days</option>
            </select>
          </label>
          <button className="button" type="submit">
            Find my trip <Search size={18} />
          </button>
        </form>
      </section>
      <section className="container section">
        <div className="section-head">
          <div>
            <span className="eyebrow">A PLACE FOR EVERY KIND OF YOU</span>
            <h2>Where will curiosity take you?</h2>
          </div>
          <Link className="text-link" to="/packages">
            Explore destinations <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="destination-grid">
          {catalog?.destinations?.map((d, i) => (
            <Link
              key={d._id}
              className="destination"
              to={`/packages?destination=${d._id}`}
            >
              <SiteImage src={d.image} alt={d.name} />
              <span className="destination-number">0{i + 1}</span>
              <div>
                <h3>{d.name}</h3>
                <p>{d.description}</p>
              </div>
              <span className="destination-arrow">
                <ArrowUpRight size={20} />
              </span>
            </Link>
          ))}
        </div>
        {catalog && !catalog.destinations.length && (
          <p className="muted">
            Your destinations will appear here when the admin adds them.
          </p>
        )}
      </section>
      <section className="tinted">
        <div className="container section">
          <div className="section-head">
            <div>
              <span className="eyebrow">GOOD PLACES. GREAT COMPANY.</span>
              <h2>Journeys worth taking.</h2>
              <p>Our handpicked escapes, with a little something extra.</p>
            </div>
            <Link className="text-link" to="/packages">
              View all journeys <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="package-grid">
            {packages.slice(0, 3).map((p) => (
              <PackageCard key={p._id} p={p} />
            ))}
          </div>
          {catalog && !packages.length && (
            <p className="muted">
              Featured journeys are being curated. Check back soon.
            </p>
          )}
        </div>
      </section>
      <section className="container section values">
        <div>
          {catalog?.sections?.find(section => section.placement === "values")?.image && <SiteImage className="values-image" src={catalog.sections.find(section => section.placement === "values").image} alt="Our journeys" />}
          <span className="eyebrow">TRAVEL WELL. FEEL EVERYTHING.</span>
          <h2>
            A trip is a place.
            <br />A journey is a feeling.
          </h2>
          <p>
            We take care of the details, so you can be right where you are.
            Present, curious, and a little more yourself.
          </p>
          <Link className="text-link" to="/packages">
            Find your kind of journey <ArrowRight size={18} />
          </Link>
        </div>
        <div className="value-grid">
          {[
            [
              Users,
              "Small groups, real connections",
              "Share the road with a few good people.",
            ],
            [
              Compass,
              "Thoughtfully put together",
              "Local experiences. Room for discovery.",
            ],
            [
              ShieldCheck,
              "Clear prices, happy travels",
              "A full price breakup before you book.",
            ],
            [Leaf, "A slower kind of travel", "More moments. More meaning."],
          ].map(([Icon, title, copy]) => (
            <div key={title}>
              <Icon />
              <h4>{title}</h4>
              <p>{copy}</p>
            </div>
          ))}
        </div>
      </section>
      {catalog?.sections?.filter(section => section.placement === "home").map(section => <section className="container section managed-section" key={section._id}>
        {section.image && <SiteImage src={section.image} alt={section.title} />}
        <div><h2>{section.title}</h2><p>{section.subtitle}</p>{section.link && <Link className="text-link" to={section.link}>Explore <ArrowUpRight size={18} /></Link>}</div>
      </section>)}
    </>
  );
}
export function PackageCard({ p }) {
  const { user, notify } = useApp();
  const navigate = useNavigate();
  async function save() {
    if (!user) return navigate("/login");
    try {
      const d = await api(`/wishlist/${p._id}`, { method: "POST" });
      notify(d.saved ? "Saved to your wishlist" : "Removed from wishlist");
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <article className="package-card">
      <div className="card-image">
        <Link to={`/packages/${p._id}`}>
          <SiteImage src={p.images?.[0]} alt={p.title} />
        </Link>
        <span className="pill">
          {p.themes?.[0]?.name || p.hotelCategory || "Group journey"}
        </span>
        <button
          className="heart"
          aria-label={`Save ${p.title} to wishlist`}
          onClick={save}
        >
          <Heart size={19} />
        </button>
      </div>
      <div className="card-body">
        <div className="card-meta">
          <span>
            <MapPin size={13} />
            {p.destination?.name}
          </span>
          <span>
            <Clock size={13} />
            {p.duration} days · {Math.max(0, p.duration - 1)} nights
          </span>
        </div>
        <Link to={`/packages/${p._id}`}>
          <h3>{p.title}</h3>
        </Link>
        <p>{p.description}</p>
        <div className="card-bottom">
          <div>
            <small>STARTING FROM</small>
            <strong>
              {p.fromPrice == null ? "View departures" : money(p.fromPrice)}
              {p.fromPrice != null && <small> / person</small>}
            </strong>
            <small>Before GST & optional extras</small>
          </div>
          <Link
            className="round-button"
            aria-label={`View ${p.title}`}
            to={`/packages/${p._id}`}
          >
            <ArrowUpRight size={21} />
          </Link>
        </div>
      </div>
    </article>
  );
}
function Listing() {
  const { catalog } = useApp();
  const [params, setParams] = useSearchParams(),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  const query = params.toString();
  useEffect(() => {
    let live = true;
    const load = () =>
      api(`/packages?${query}`)
        .then((d) => {
          if (live) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => { if (live) { setData(null); setError(e.message); } });
    load();
    const t = liveInterval(load, 10000);
    return () => {
      live = false;
      clearLiveInterval(t);
    };
  }, [query]);
  const change = (key, value) => {
    const p = new URLSearchParams(params);
    value ? p.set(key, value) : p.delete(key);
    if (key !== "page") p.delete("page");
    setParams(p);
  };
  return (
    <div className="container section">
      <span className="eyebrow">YOUR NEXT STORY</span>
      <h1 className="page-title">Find your kind of somewhere.</h1>
      <p className="muted">Thoughtfully planned escapes, ready when you are.</p>
      <div className="listing-layout">
        <aside className="filters">
          <h3>Make it yours</h3>
          <label>
            Search
            <input
              placeholder="A place or a feeling…"
              value={params.get("search") || ""}
              onChange={(e) => change("search", e.target.value)}
            />
          </label>
          <label>
            Destination
            <select
              value={params.get("destination") || ""}
              onChange={(e) => change("destination", e.target.value)}
            >
              <option value="">Everywhere</option>
              {catalog?.destinations.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Duration
            <select
              value={params.get("duration") || ""}
              onChange={(e) => change("duration", e.target.value)}
            >
              <option value="">Any duration</option>
              <option value="1-4">1–4 days</option>
              <option value="5-7">5–7 days</option>
              <option value="8-365">8+ days</option>
            </select>
          </label>
          <label>
            Travel style
            <select
              value={params.get("theme") || ""}
              onChange={(e) => change("theme", e.target.value)}
            >
              <option value="">All styles</option>
              {catalog?.themes.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Min price (₹)
            <input
              type="number"
              min="0"
              value={params.get("minPrice") || ""}
              onChange={(e) => change("minPrice", e.target.value)}
            />
          </label>
          <label>
            Max price (₹)
            <input
              type="number"
              min="0"
              value={params.get("maxPrice") || ""}
              onChange={(e) => change("maxPrice", e.target.value)}
            />
          </label>
          <button className="text-link" onClick={() => setParams({})}>
            Clear filters
          </button>
        </aside>
        <div>
          <div className="results-toolbar">
            <span>
              {data
                ? `${data.total} journeys to look forward to`
                : "Finding your journeys…"}
            </span>
            <select
              aria-label="Sort journeys"
              value={params.get("sort") || ""}
              onChange={(e) => change("sort", e.target.value)}
            >
              <option value="">Recommended</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="duration">Shortest first</option>
            </select>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="package-grid two">
            {data?.items.map((p) => (
              <PackageCard key={p._id} p={p} />
            ))}
          </div>
          {data && !data.items.length && (
            <Empty
              title="A little off the beaten path."
              text="Try changing your filters to discover more journeys."
            />
          )}
          <div className="pagination">
            {Array.from({ length: data?.pages || 0 }, (_, i) => (
              <button
                className={
                  Number(params.get("page") || 1) === i + 1 ? "active" : ""
                }
                key={i}
                onClick={() => change("page", String(i + 1))}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function Detail() {
  const { id } = useParams(),
    { catalog, user, notify } = useApp(),
    navigate = useNavigate();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [choice, setChoice] = useState({
      departure: "",
      adults: 2,
      children: 0,
      sharing: "twin",
      addons: [],
    }),
    [price, setPrice] = useState(null),
    [quoteError, setQuoteError] = useState(""),
    [checkout, setCheckout] = useState(false),
    [travellers, setTravellers] = useState([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      api(`/packages/${id}`)
        .then((d) => {
          if (live) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => live && setError(e.message));
    load();
    const t = liveInterval(load, 5000);
    return () => {
      live = false;
      clearLiveInterval(t);
    };
  }, [id]);
  useEffect(() => {
    setPrice(null);
    if (!choice.departure) return;
    let live = true;
    const load = () =>
      api("/quote", { method: "POST", body: choice })
        .then((d) => {
          if (live) {
            setPrice(d);
            setQuoteError("");
          }
        })
        .catch((e) => {
          if (live) {
            setPrice(null);
            setQuoteError(e.message);
          }
        });
    load();
    const t = liveInterval(load, 5000);
    return () => {
      live = false;
      clearLiveInterval(t);
    };
  }, [JSON.stringify(choice)]);
  useEffect(() => {
    setCheckout(false);
    setTravellers(
      Array.from({ length: choice.adults + choice.children }, () => ({
        name: "",
        age: "",
        idProof: "",
      })),
    );
  }, [choice.adults, choice.children, choice.departure]);
  if (error) return <Empty title="Journey unavailable" text={error} />;
  if (!data) return <Loading />;
  const p = data.package;
  const set = (k, v) => setChoice((c) => ({ ...c, [k]: v }));
  const status = (d) =>
    d.closed || new Date(d.date) <= new Date()
      ? "Closed"
      : d.totalSeats - d.bookedSeats <= 0
        ? "Sold Out"
        : `${d.totalSeats - d.bookedSeats} seats left`;
  async function book(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/bookings", {
        method: "POST",
        body: {
          ...choice,
          expectedTotal: price.total,
          travellers: travellers.map((t) => ({ ...t, age: Number(t.age) })),
        },
      });
      notify("Your journey is booked. Pay later with the agency.");
      navigate("/bookings");
    } catch (e) {
      setQuoteError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container section">
      <Link className="text-link" to="/packages">
        ← All journeys
      </Link>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">
            {p.destination?.name} · {p.themes.map((t) => t.name).join(" / ")}
          </span>
          <h1 className="page-title">{p.title}</h1>
          <p>
            <Clock size={16} /> {p.duration} days / {p.duration - 1} nights{" "}
            <span className="separator">·</span> {p.hotelCategory}
          </p>
        </div>
      </div>
      <div className="gallery">
        {p.images.map((img, i) => (
          <SiteImage key={img} src={img} alt={`${p.title} — view ${i + 1}`} />
        ))}
      </div>
      <div className="detail-layout">
        <div>
          <h2>
            A change of scenery.
            <br />A world of possibility.
          </h2>
          <p className="description">{p.description}</p>
          <section className="detail-section">
            <span className="eyebrow">THE DAYS AHEAD</span>
            <h2>Your journey, day by day.</h2>
            <div className="itinerary">
              {p.itinerary.map((day, i) => (
                <details key={day._id || i} open={i === 0}>
                  <summary>
                    <span>DAY {day.day}</span>
                    {day.title}
                    <ChevronDown size={16} />
                  </summary>
                  <p>{day.description}</p>
                </details>
              ))}
            </div>
          </section>
          <div className="included-grid">
            <div>
              <h3>All taken care of</h3>
              {p.inclusions.map((x) => (
                <p key={x}>
                  <Check size={16} />
                  {x}
                </p>
              ))}
            </div>
            <div>
              <h3>A little extra</h3>
              {p.exclusions.map((x) => (
                <p key={x}>
                  <Minus size={16} />
                  {x}
                </p>
              ))}
            </div>
          </div>
          <section className="detail-section">
            <h3>Upcoming departures</h3>
            <div className="departure-list">
              {data.departures.map((d) => (
                <button
                  key={d._id}
                  disabled={status(d) === "Closed" || status(d) === "Sold Out"}
                  className={choice.departure === d._id ? "selected" : ""}
                  onClick={() => set("departure", d._id)}
                >
                  <strong>{date(d.date)}</strong>
                  <span>
                    {d.season} · {money(d.adultRate * d.seasonMultiplier)}
                  </span>
                  <span className="badge">{status(d)}</span>
                </button>
              ))}
            </div>
            <p className="muted small-text">
              Rates include the departure’s season multiplier. Availability
              refreshes every 5 seconds.
            </p>
          </section>
        </div>
        <aside className="booking-panel">
          <span className="eyebrow">A GOOD TIME STARTS HERE</span>
          <h3>Make this journey yours.</h3>
          <label>
            Departure
            <select
              aria-label="Departure"
              value={choice.departure}
              onChange={(e) => set("departure", e.target.value)}
            >
              <option value="">Pick a date</option>
              {data.departures.map((d) => (
                <option
                  key={d._id}
                  value={d._id}
                  disabled={["Closed", "Sold Out"].includes(status(d))}
                >
                  {date(d.date)} · {status(d)}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Adults
              <input
                type="number"
                min="1"
                max="30"
                value={choice.adults}
                onChange={(e) => set("adults", Number(e.target.value))}
              />
            </label>
            <label>
              Children (≤{catalog?.settings?.childAgeLimit})
              <input
                type="number"
                min="0"
                max="29"
                value={choice.children}
                onChange={(e) => set("children", Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            Room sharing
            <select
              aria-label="Room sharing"
              value={choice.sharing}
              onChange={(e) => set("sharing", e.target.value)}
            >
              <option value="twin">Twin sharing</option>
              <option value="triple">Triple sharing</option>
              <option value="single">Single occupancy</option>
            </select>
          </label>
          <fieldset>
            <legend>The little extras</legend>
            {catalog?.addons.map((a) => (
              <label className="check-label" key={a._id}>
                <input
                  type="checkbox"
                  checked={choice.addons.includes(a._id)}
                  onChange={(e) =>
                    set(
                      "addons",
                      e.target.checked
                        ? [...choice.addons, a._id]
                        : choice.addons.filter((x) => x !== a._id),
                    )
                  }
                />
                <span>
                  {a.name}
                  <small>
                    {money(a.price)}{" "}
                    {a.perPerson ? "per traveller" : "per booking"}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          {price ? (
            <Price price={price} />
          ) : (
            <p className="muted">
              Choose your departure to see your price breakup.
            </p>
          )}
          {quoteError && (
            <p className="error" role="alert">
              {quoteError}
            </p>
          )}
          {!checkout ? (
            <button
              className="button full"
              disabled={!price}
              onClick={() =>
                user
                  ? setCheckout(true)
                  : navigate("/login", { state: { from: `/packages/${id}` } })
              }
            >
              Continue to traveller details <ArrowRight size={18} />
            </button>
          ) : (
            <form onSubmit={book}>
              <h3>Who’s coming along?</h3>
              {travellers.map((t, i) => (
                <fieldset className="traveller" key={i}>
                  <legend>Traveller {i + 1}</legend>
                  {["name", "age", "idProof"].map((key) => (
                    <label key={key}>
                      {key === "idProof"
                        ? "ID proof number"
                        : key === "age"
                          ? "Age"
                          : "Full name"}
                      <input
                        required
                        type={key === "age" ? "number" : "text"}
                        min={key === "age" ? 0 : undefined}
                        max={key === "age" ? 120 : undefined}
                        value={t[key]}
                        onChange={(e) =>
                          setTravellers((ts) =>
                            ts.map((v, j) =>
                              j === i ? { ...v, [key]: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
              <p className="muted small-text">
                Pay Later — no online payment is collected. The agency will
                contact you. Cancellation cut-off:{" "}
                {catalog?.settings?.cancellationCutoff} days before departure.
              </p>
              <button className="button full" disabled={busy || !price}>
                {busy
                  ? "Reserving seats…"
                  : `Book now · ${money(price?.total)}`}
              </button>
            </form>
          )}
          <p className="panel-foot">
            <ShieldCheck size={15} /> Clear pricing. No hidden detours.
          </p>
        </aside>
      </div>
    </div>
  );
}
function Price({ price }) {
  return (
    <div className="price-breakdown">
      <div>
        <span>Adults · season rate</span>
        <span>{money(price.adultTotal)}</span>
      </div>
      <div>
        <span>Children · season rate</span>
        <span>{money(price.childTotal)}</span>
      </div>
      <div>
        <span>Room sharing</span>
        <span>{money(price.roomCharge)}</span>
      </div>
      {price.extras.map((e) => (
        <div key={e.name}>
          <span>{e.name}</span>
          <span>{money(e.amount)}</span>
        </div>
      ))}
      <div>
        <span>GST ({price.gst}%)</span>
        <span>{money(price.tax)}</span>
      </div>
      <div className="price-total">
        <strong>Your total</strong>
        <strong>{money(price.total)}</strong>
      </div>
    </div>
  );
}
function Account({ profile = false }) {
  const { user, ready, setUser, notify } = useApp(),
    [bookings, setBookings] = useState(null),
    [error, setError] = useState("");
  const load = () =>
    api("/bookings")
      .then(setBookings)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!user || profile) return;
    load();
    const t = liveInterval(load, 5000);
    return () => clearLiveInterval(t);
  }, [user, profile]);
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" />;
  return (
    <div className="container section">
      <span className="eyebrow">YOUR LITTLE CORNER OF THE WORLD</span>
      <h1 className="page-title">
        {profile ? "Hello, " + user.name + "." : "Journeys to look forward to."}
      </h1>
      {error && <p className="error">{error}</p>}
      {profile ? (
        <form
          className="profile-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const u = await api("/auth/profile", {
                method: "PUT",
                body: { name: e.target.name.value },
              });
              setUser(u);
              notify("Profile updated");
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <label>
            Your name
            <input
              name="name"
              defaultValue={user.name}
              required
              minLength="2"
            />
          </label>
          <label>
            Email
            <input value={user.email} disabled />
          </label>
          <button className="button">Save profile</button>
          <Link className="text-link" to="/bookings">
            View my bookings <ArrowRight size={16} />
          </Link>
        </form>
      ) : (
        <div className="bookings-list">
          {bookings?.map((b) => (
            <article className="booking-card" key={b._id}>
              <SiteImage src={b.package?.images?.[0]} alt="" />
              <div>
                <span className={`status ${b.status.toLowerCase()}`}>
                  {b.status}
                </span>
                <h3>{b.package?.title || "Archived package"}</h3>
                <p>
                  {b.departure
                    ? date(b.departure.date)
                    : "Departure unavailable"}{" "}
                  · {b.adults} adults, {b.children} children · {b.sharing}{" "}
                  sharing
                </p>
                <small>
                  Reference: {b._id.slice(-8).toUpperCase()} · Pay Later
                </small>
                <details>
                  <summary>View travellers & price breakup</summary>
                  {b.travellers.map((t, i) => (
                    <p key={i}>
                      {t.name} · Age {t.age}
                    </p>
                  ))}
                  <Price price={b.price} />
                </details>
              </div>
              <div>
                <strong>{money(b.price.total)}</strong>
                {!["Cancelled", "Completed"].includes(b.status) && (
                  <button
                    className="text-link danger"
                    onClick={async () => {
                      if (
                        !confirm(
                          "Cancel this booking? Your seats will be released.",
                        )
                      )
                        return;
                      try {
                        await api(`/bookings/${b._id}/cancel`, {
                          method: "POST",
                        });
                        load();
                        notify("Booking cancelled; seats returned");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Cancel booking
                  </button>
                )}
              </div>
            </article>
          ))}
          {bookings && !bookings.length && (
            <Empty
              title="Your next chapter is unwritten."
              text="Find a journey you love and we’ll take it from there."
            />
          )}
        </div>
      )}
    </div>
  );
}
function Wishlist() {
  const { user, ready } = useApp(),
    [items, setItems] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    const load = () =>
      api("/wishlist")
        .then(setItems)
        .catch((e) => setError(e.message));
    load();
    const t = liveInterval(load, 5000);
    return () => clearLiveInterval(t);
  }, [user]);
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" />;
  return (
    <div className="container section">
      <span className="eyebrow">PLACES ON YOUR MIND</span>
      <h1 className="page-title">A little collection of someday.</h1>
      {error && <p className="error">{error}</p>}
      <div className="package-grid">
        {items?.map((p) => (
          <PackageCard p={p} key={p._id} />
        ))}
      </div>
      {items && !items.length && (
        <Empty
          title="Save a little inspiration."
          text="Tap the heart on a journey to keep it here."
        />
      )}
    </div>
  );
}
export function Empty({ title, text }) {
  return (
    <div className="empty">
      <Compass size={36} />
      <h2>{title}</h2>
      <p>{text}</p>
      <Link className="button" to="/packages">
        Explore journeys <ArrowUpRight size={16} />
      </Link>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <Compass />
      <p>Getting things ready…</p>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);


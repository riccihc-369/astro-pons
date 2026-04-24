import { useEffect, useMemo, useRef, useState } from "react";
import { Body, Equator, Horizon, Observer } from "astronomy-engine";

type SkyBody = {
  body: Body;
  label: string;
};

type BodyRow = {
  id: string;
  label: string;
  azimuth: number;
  altitude: number;
  visible: boolean;
};

type GpsState = {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  error: string | null;
};

type OrientationState = {
  enabled: boolean;
  rawHeading: number | null;
  smoothHeading: number | null;
  beta: number | null;
  gamma: number | null;
  deviceAltitude: number | null;
  error: string | null;
};

const OFFSET_KEY = "astroPons.compassOffsetDeg";

const SKY_BODIES: SkyBody[] = [
  { body: Body.Sun, label: "Sole" },
  { body: Body.Moon, label: "Luna" },
  { body: Body.Mercury, label: "Mercurio" },
  { body: Body.Venus, label: "Venere" },
  { body: Body.Mars, label: "Marte" },
  { body: Body.Jupiter, label: "Giove" },
  { body: Body.Saturn, label: "Saturno" },
];

function normalize360(v: number) {
  return ((v % 360) + 360) % 360;
}

function normalize180(v: number) {
  const n = normalize360(v);
  return n > 180 ? n - 360 : n;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function circularMeanDeg(values: number[]) {
  if (!values.length) return null;

  let sin = 0;
  let cos = 0;

  for (const d of values) {
    const r = (d * Math.PI) / 180;
    sin += Math.sin(r);
    cos += Math.cos(r);
  }

  const a = Math.atan2(sin / values.length, cos / values.length);
  return normalize360((a * 180) / Math.PI);
}

function formatDeg(v: number | null, digits = 1) {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}°`;
}

function estimateAltitude(beta: number | null) {
  if (beta === null) return null;
  return clamp(90 - beta, -90, 90);
}

function directionText(delta: number | null) {
  if (delta === null) return "Bussola non attiva";
  if (Math.abs(delta) <= 1.5) return "Azimut centrato";
  return delta > 0 ? "Ruota a destra →" : "← Ruota a sinistra";
}

function altitudeText(delta: number | null) {
  if (delta === null) return "Inclinazione non disponibile";
  if (Math.abs(delta) <= 2) return "Altezza centrata";
  return delta > 0 ? "Alza ↑" : "Abbassa ↓";
}

export default function App() {
  const [gps, setGps] = useState<GpsState>({
    lat: null,
    lon: null,
    accuracy: null,
    error: null,
  });

  const [rows, setRows] = useState<BodyRow[]>([]);
  const [selectedId, setSelectedId] = useState("Luna");

  const [orientation, setOrientation] = useState<OrientationState>({
    enabled: false,
    rawHeading: null,
    smoothHeading: null,
    beta: null,
    gamma: null,
    deviceAltitude: null,
    error: null,
  });

  const [offsetDeg, setOffsetDeg] = useState<number>(() => {
    const saved = localStorage.getItem(OFFSET_KEY);
    const parsed = saved ? Number(saved) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  });

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  const headingSamplesRef = useRef<number[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const selectedTarget = useMemo(() => {
    return rows.find((r) => r.id === selectedId) ?? rows[1] ?? null;
  }, [rows, selectedId]);

  const correctedHeading = useMemo(() => {
    if (orientation.smoothHeading === null) return null;
    return normalize360(orientation.smoothHeading + offsetDeg);
  }, [orientation.smoothHeading, offsetDeg]);

  const deltaAz = useMemo(() => {
    if (!selectedTarget || correctedHeading === null) return null;
    return normalize180(selectedTarget.azimuth - correctedHeading);
  }, [selectedTarget, correctedHeading]);

  const deltaAlt = useMemo(() => {
    if (!selectedTarget || orientation.deviceAltitude === null) return null;
    return selectedTarget.altitude - orientation.deviceAltitude;
  }, [selectedTarget, orientation.deviceAltitude]);

  const azLock = deltaAz !== null && Math.abs(deltaAz) <= 1.5;
  const altLock = deltaAlt !== null && Math.abs(deltaAlt) <= 2;
  const targetLock = azLock && altLock;

  const arMarker = useMemo(() => {
    if (deltaAz === null || deltaAlt === null) return null;

    const hFov = 60;
    const vFov = 45;

    const rawX = 50 + (deltaAz / (hFov / 2)) * 50;
    const rawY = 50 - (deltaAlt / (vFov / 2)) * 50;

    return {
      x: clamp(rawX, 6, 94),
      y: clamp(rawY, 6, 94),
      inside: rawX >= 0 && rawX <= 100 && rawY >= 0 && rawY <= 100,
    };
  }, [deltaAz, deltaAlt]);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    setIsStandalone(standalone);
  }, []);

  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null,
        });
      },
      (err) => {
        setGps((p) => ({ ...p, error: err.message }));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (gps.lat === null || gps.lon === null) return;

    const run = () => {
      const now = new Date();
      const observer = new Observer(gps.lat!, gps.lon!, 0);

      const data = SKY_BODIES.map(({ body, label }) => {
        const eq = Equator(body, now, observer, true, true);
        const hor = Horizon(now, observer, eq.ra, eq.dec, "normal");

        return {
          id: label,
          label,
          azimuth: hor.azimuth,
          altitude: hor.altitude,
          visible: hor.altitude > 0,
        };
      });

      setRows(data);
    };

    run();
    const t = window.setInterval(run, 5000);
    return () => clearInterval(t);
  }, [gps.lat, gps.lon]);

  useEffect(() => {
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function enableCompass() {
    const DeviceOrientation = DeviceOrientationEvent as any;

    try {
      if (typeof DeviceOrientation.requestPermission === "function") {
        const res = await DeviceOrientation.requestPermission();
        if (res !== "granted") {
          setOrientation((p) => ({
            ...p,
            error: "Permesso orientamento negato.",
          }));
          return;
        }
      }

      window.addEventListener("deviceorientation", handleOrientation, true);

      setOrientation((p) => ({
        ...p,
        enabled: true,
        error: null,
      }));
    } catch (e) {
      setOrientation((p) => ({
        ...p,
        error: "Errore bussola.",
      }));
    }
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    const e = event as any;

    let raw: number | null = null;

    if (typeof e.webkitCompassHeading === "number") {
      raw = normalize360(e.webkitCompassHeading);
    } else if (typeof event.alpha === "number") {
      raw = normalize360(360 - event.alpha);
    }

    const beta =
      typeof event.beta === "number" ? event.beta : null;
    const gamma =
      typeof event.gamma === "number" ? event.gamma : null;

    if (raw !== null) {
      headingSamplesRef.current = [...headingSamplesRef.current, raw].slice(-10);
    }

    setOrientation((p) => ({
      ...p,
      rawHeading: raw,
      smoothHeading: circularMeanDeg(headingSamplesRef.current),
      beta,
      gamma,
      deviceAltitude: estimateAltitude(beta),
      error: null,
    }));
  }

  function calibrateOnMoon() {
    const moon = rows.find((r) => r.id === "Luna");
    if (!moon || orientation.smoothHeading === null) return;

    const next = normalize180(moon.azimuth - orientation.smoothHeading);
    setOffsetDeg(next);
    localStorage.setItem(OFFSET_KEY, String(next));
  }

  function resetCalibration() {
    setOffsetDeg(0);
    localStorage.removeItem(OFFSET_KEY);
  }

  async function startCamera() {
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Serve HTTPS o localhost.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      streamRef.current = stream;
      setCameraActive(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 0);
    } catch {
      if (isStandalone) {
        setCameraError(
          "Modalità App iPhone limitata. Apri Astro Pons in Safari per camera AR."
        );
      } else {
        setCameraError("Permesso camera negato.");
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;

    setCameraActive(false);
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Moon Compass</h1>
      <p style={styles.subtitle}>V4.1 UX + AR Overlay</p>

      <section style={styles.card}>
        <strong>
          Lat {gps.lat?.toFixed(4) ?? "—"} / Lon {gps.lon?.toFixed(4) ?? "—"}
        </strong>
        <div>
          GPS {gps.accuracy ? `±${gps.accuracy.toFixed(0)}m` : "—"} | Heading{" "}
          {formatDeg(orientation.smoothHeading)}
        </div>
      </section>

      <section style={styles.card}>
        <button style={styles.btnBlue} onClick={enableCompass}>
          Attiva bussola
        </button>
        <button style={styles.btnYellow} onClick={calibrateOnMoon}>
          Calibra su Luna
        </button>
        <button style={styles.btnGray} onClick={resetCalibration}>
          Reset
        </button>
      </section>

      <section style={targetLock ? styles.lockCard : styles.card}>
        <h2>Precision Telescope</h2>
        <div>Target: {selectedTarget?.label}</div>

        {targetLock ? (
          <div style={styles.lockText}>✓ TARGET LOCK</div>
        ) : (
          <>
            <div>{directionText(deltaAz)}</div>
            <div>{altitudeText(deltaAlt)}</div>
          </>
        )}
      </section>

      <section style={styles.card}>
        <select
          style={styles.select}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </section>

      <section style={styles.arCard}>
        <h2>AR Sky Overlay</h2>

        {isStandalone && (
          <div style={styles.notice}>
            Modalità App rilevata. Se la camera non parte, apri in Safari.
          </div>
        )}

        <button style={styles.btnBlue} onClick={startCamera}>
          Avvia AR Camera
        </button>

        <button style={styles.btnGray} onClick={stopCamera}>
          Stop Camera
        </button>

        {cameraError && <p style={styles.error}>{cameraError}</p>}

        <div style={styles.arFrame}>
          {cameraActive ? (
            <video ref={videoRef} playsInline muted style={styles.video} />
          ) : (
            <div style={styles.placeholder}>Camera non attiva</div>
          )}

          <div style={styles.overlay}>
            <div style={styles.reticle} />

            {arMarker && (
              <div
                style={{
                  ...styles.marker,
                  left: `${arMarker.x}%`,
                  top: `${arMarker.y}%`,
                }}
              >
                ●
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#05081f",
    color: "#fff",
    padding: 16,
    fontFamily: "system-ui",
  },
  title: {
    color: "#ffd400",
    fontSize: 40,
    marginBottom: 0,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    color: "#9ca3b7",
    marginTop: 6,
  },
  card: {
    background: "#1b203a",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  lockCard: {
    background: "#102b21",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    border: "2px solid #15ff31",
  },
  lockText: {
    color: "#15ff31",
    fontSize: 32,
    fontWeight: 900,
    textAlign: "center",
  },
  btnBlue: {
    width: "100%",
    padding: 14,
    marginBottom: 10,
    borderRadius: 12,
    border: 0,
    fontWeight: 900,
    background: "#00b7ff",
  },
  btnYellow: {
    width: "100%",
    padding: 14,
    marginBottom: 10,
    borderRadius: 12,
    border: 0,
    fontWeight: 900,
    background: "#ffd400",
  },
  btnGray: {
    width: "100%",
    padding: 14,
    marginBottom: 10,
    borderRadius: 12,
    border: 0,
    fontWeight: 900,
    background: "#707070",
    color: "#fff",
  },
  select: {
    width: "100%",
    padding: 14,
    borderRadius: 12,
    fontSize: 18,
  },
  arCard: {
    background: "#10162d",
    borderRadius: 16,
    padding: 16,
  },
  notice: {
    background: "rgba(255,212,0,.12)",
    color: "#ffd400",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    fontWeight: 800,
  },
  arFrame: {
    position: "relative",
    marginTop: 12,
    background: "#000",
    borderRadius: 16,
    overflow: "hidden",
    minHeight: 360,
  },
  video: {
    width: "100%",
    height: 420,
    objectFit: "cover",
    display: "block",
  },
  placeholder: {
    height: 420,
    display: "grid",
    placeItems: "center",
    color: "#999",
  },
  overlay: {
    position: "absolute",
    inset: 0,
  },
  reticle: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 90,
    height: 90,
    transform: "translate(-50%, -50%)",
    border: "2px solid white",
    borderRadius: "50%",
  },
  marker: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    color: "#ffd400",
    fontSize: 28,
    fontWeight: 900,
    textShadow: "0 0 12px #ffd400",
  },
  error: {
    color: "#ff6666",
    fontWeight: 800,
  },
};
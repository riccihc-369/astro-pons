import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
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

type ObservationItem = {
  id: string;
  label: string;
  bestTime: string;
  bestAltitude: number;
  currentAltitude: number | null;
  score: number;
  rating: string;
  advice: string;
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

function normalize360(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalize180(value: number): number {
  const normalized = normalize360(value);
  return normalized > 180 ? normalized - 360 : normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function circularMeanDeg(values: number[]): number | null {
  if (values.length === 0) return null;

  let sinSum = 0;
  let cosSum = 0;

  for (const deg of values) {
    const rad = (deg * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }

  const meanRad = Math.atan2(sinSum / values.length, cosSum / values.length);
  return normalize360((meanRad * 180) / Math.PI);
}

function estimateDeviceAltitude(beta: number | null): number | null {
  if (beta === null || !Number.isFinite(beta)) return null;

  // Stima pratica per iPhone in portrait:
  // beta ~ 90° = telefono verticale verso orizzonte => altitudine ~ 0°
  // beta ~ 60° = telefono inclinato verso alto => altitudine ~ +30°
  // beta ~ 120° = telefono inclinato verso basso => altitudine ~ -30°
  return clamp(90 - beta, -90, 90);
}

function formatDeg(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}°`;
}

function directionText(deltaAz: number | null): string {
  if (deltaAz === null) return "Bussola non attiva";
  if (Math.abs(deltaAz) <= 1.5) return "Azimut centrato";
  return deltaAz > 0 ? "Ruota a destra →" : "← Ruota a sinistra";
}

function altitudeText(deltaAlt: number | null): string {
  if (deltaAlt === null) return "Inclinazione non disponibile";
  if (Math.abs(deltaAlt) <= 2.0) return "Altezza centrata";
  return deltaAlt > 0 ? "Alza ↑" : "Abbassa ↓";
}

function scoreObservation(altitude: number): number {
  if (altitude <= 0) return 0;
  if (altitude >= 55) return 100;
  if (altitude >= 40) return 85;
  if (altitude >= 25) return 70;
  if (altitude >= 15) return 50;
  return 25;
}

function ratingFromScore(score: number): string {
  if (score >= 85) return "OTTIMO";
  if (score >= 70) return "BUONO";
  if (score >= 50) return "DISCRETO";
  return "SCARSO";
}

function adviceFromAltitude(label: string, altitude: number): string {
  if (altitude >= 50) return `${label} molto favorevole: alto/a e comodo/a da puntare.`;
  if (altitude >= 30) return `${label} buon target nelle prossime ore.`;
  if (altitude >= 15) return `${label} visibile, ma ancora abbastanza basso/a.`;
  if (altitude > 0) return `${label} basso/a: meglio attendere se sta salendo.`;
  return `${label} sotto orizzonte.`;
}

function buildObservationPlan(
  lat: number,
  lon: number,
  rows: BodyRow[]
): ObservationItem[] {
  const observer = new Observer(lat, lon, 0);
  const now = new Date();

  return SKY_BODIES.map(({ body, label }) => {
    let bestAltitude = -90;
    let bestDate = now;

    // Prossime 6 ore, step ogni 15 minuti.
    for (let i = 0; i <= 24; i += 1) {
      const t = new Date(now.getTime() + i * 15 * 60 * 1000);
      const eq = Equator(body, t, observer, true, true);
      const hor = Horizon(t, observer, eq.ra, eq.dec, "normal");

      if (hor.altitude > bestAltitude) {
        bestAltitude = hor.altitude;
        bestDate = t;
      }
    }

    const currentAltitude =
      rows.find((row) => row.label === label)?.altitude ?? null;

    const score = scoreObservation(bestAltitude);

    return {
      id: label,
      label,
      bestTime: bestDate.toLocaleTimeString("it-CH", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      bestAltitude,
      currentAltitude,
      score,
      rating: ratingFromScore(score),
      advice: adviceFromAltitude(label, bestAltitude),
    };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
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
    const parsed = saved === null ? 0 : Number(saved);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  const headingSamplesRef = useRef<number[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const selectedTarget = useMemo(() => {
    return (
      rows.find((row) => row.id === selectedId) ??
      rows.find((row) => row.id === "Luna") ??
      null
    );
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
  const altLock = deltaAlt !== null && Math.abs(deltaAlt) <= 2.0;
  const targetLock = azLock && altLock;

  const arMarker = useMemo(() => {
    if (deltaAz === null || deltaAlt === null) return null;

    const horizontalFovDeg = 60;
    const verticalFovDeg = 45;

    const rawX = 50 + (deltaAz / (horizontalFovDeg / 2)) * 50;
    const rawY = 50 - (deltaAlt / (verticalFovDeg / 2)) * 50;

    const inside = rawX >= 0 && rawX <= 100 && rawY >= 0 && rawY <= 100;

    return {
      x: clamp(rawX, 6, 94),
      y: clamp(rawY, 6, 94),
      inside,
    };
  }, [deltaAz, deltaAlt]);

  const observationPlan = useMemo(() => {
    if (gps.lat === null || gps.lon === null) return [];
    return buildObservationPlan(gps.lat, gps.lon, rows);
  }, [gps.lat, gps.lon, rows]);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    setIsStandalone(standalone);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGps((prev) => ({
        ...prev,
        error: "GPS non disponibile su questo browser.",
      }));
      return;
    }

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
        setGps((prev) => ({
          ...prev,
          error: `GPS: ${err.message}`,
        }));
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

    const calculate = () => {
      const now = new Date();
      const observer = new Observer(gps.lat!, gps.lon!, 0);

      const nextRows = SKY_BODIES.map(({ body, label }) => {
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

      setRows(nextRows);
    };

    calculate();
    const interval = window.setInterval(calculate, 5000);

    return () => window.clearInterval(interval);
  }, [gps.lat, gps.lon]);

  useEffect(() => {
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function enableCompass() {
    setOrientation((prev) => ({ ...prev, error: null }));

    const DeviceOrientation = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    try {
      if (typeof DeviceOrientation.requestPermission === "function") {
        const permission = await DeviceOrientation.requestPermission();

        if (permission !== "granted") {
          setOrientation((prev) => ({
            ...prev,
            enabled: false,
            error: "Permesso orientamento negato.",
          }));
          return;
        }
      }

      window.addEventListener("deviceorientation", handleOrientation, true);

      setOrientation((prev) => ({
        ...prev,
        enabled: true,
        error: null,
      }));
    } catch (error) {
      setOrientation((prev) => ({
        ...prev,
        enabled: false,
        error:
          error instanceof Error
            ? error.message
            : "Errore attivazione bussola.",
      }));
    }
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    const compassEvent = event as DeviceOrientationEvent & {
      webkitCompassHeading?: number;
    };

    let rawHeading: number | null = null;

    if (
      typeof compassEvent.webkitCompassHeading === "number" &&
      Number.isFinite(compassEvent.webkitCompassHeading)
    ) {
      rawHeading = normalize360(compassEvent.webkitCompassHeading);
    } else if (typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
      rawHeading = normalize360(360 - event.alpha);
    }

    const beta =
      typeof event.beta === "number" && Number.isFinite(event.beta)
        ? event.beta
        : null;

    const gamma =
      typeof event.gamma === "number" && Number.isFinite(event.gamma)
        ? event.gamma
        : null;

    const deviceAltitude = estimateDeviceAltitude(beta);

    if (rawHeading !== null) {
      headingSamplesRef.current = [...headingSamplesRef.current, rawHeading].slice(
        -10
      );
    }

    const smoothHeading = circularMeanDeg(headingSamplesRef.current);

    setOrientation((prev) => ({
      ...prev,
      rawHeading,
      smoothHeading,
      beta,
      gamma,
      deviceAltitude,
      error: null,
    }));
  }

  function calibrateOnMoon() {
    const moon = rows.find((row) => row.id === "Luna");
    if (!moon || orientation.smoothHeading === null) return;

    const nextOffset = normalize180(moon.azimuth - orientation.smoothHeading);
    setOffsetDeg(nextOffset);
    localStorage.setItem(OFFSET_KEY, String(nextOffset));
  }

  function resetCalibration() {
    setOffsetDeg(0);
    localStorage.removeItem(OFFSET_KEY);
  }

  async function startCamera() {
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera non disponibile. Serve HTTPS o localhost.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraActive(true);

      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 0);
    } catch (error) {
      if (isStandalone) {
        setCameraError(
          "Su iPhone in modalità App la camera può essere limitata. Apri Astro Pons in Safari per AR completo."
        );
      } else {
        setCameraError(
          error instanceof Error ? error.message : "Permesso camera negato."
        );
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <h1 style={styles.title}>Moon Compass</h1>
        <p style={styles.subtitle}>V5 — Observation Pro + AR Sky Overlay</p>
      </section>

      <section style={styles.statusCard}>
        <strong>
          Lat {gps.lat?.toFixed(4) ?? "—"} / Lon {gps.lon?.toFixed(4) ?? "—"}
        </strong>
        <span>
          {" | "}
          GPS {gps.accuracy !== null ? `±${gps.accuracy.toFixed(0)}m` : "—"}
          {" | "}
          Heading {formatDeg(orientation.smoothHeading)}
        </span>
        {gps.error && <p style={styles.error}>{gps.error}</p>}
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Bussola + Calibrazione</h2>

        <div style={styles.grid2}>
          <Info label="Heading raw" value={formatDeg(orientation.rawHeading)} />
          <Info
            label="Heading smooth"
            value={formatDeg(orientation.smoothHeading)}
          />
          <Info label="Offset calibrazione" value={formatDeg(offsetDeg)} />
          <Info label="Heading corretto" value={formatDeg(correctedHeading)} />
          <Info
            label="Pitch stimato"
            value={formatDeg(orientation.deviceAltitude)}
          />
          <Info
            label="Beta/Gamma"
            value={`${formatDeg(orientation.beta)} / ${formatDeg(
              orientation.gamma
            )}`}
          />
        </div>

        {orientation.error && <p style={styles.error}>{orientation.error}</p>}

        <div style={styles.buttonRow}>
          <button style={styles.primaryButton} onClick={enableCompass}>
            Attiva bussola
          </button>

          <button
            style={styles.yellowButton}
            onClick={calibrateOnMoon}
            disabled={
              !rows.find((row) => row.id === "Luna") ||
              orientation.smoothHeading === null
            }
          >
            Calibra su Luna
          </button>

          <button style={styles.secondaryButton} onClick={resetCalibration}>
            Reset calibrazione
          </button>
        </div>
      </section>

      <section style={targetLock ? styles.lockCard : styles.card}>
        <h2 style={styles.sectionTitle}>Precision Telescope</h2>

        <div style={styles.targetName}>
          Target: <strong>{selectedTarget?.label ?? "—"}</strong>
        </div>

        {targetLock ? (
          <div style={styles.lockText}>✓ TARGET LOCK</div>
        ) : (
          <div style={styles.precisionGrid}>
            <div style={styles.directionBox}>
              <div style={azLock ? styles.okText : styles.bigYellow}>
                {directionText(deltaAz)}
              </div>
              <div style={styles.metric}>Delta Az: {formatDeg(deltaAz)}</div>
            </div>

            <div style={styles.directionBox}>
              <div style={altLock ? styles.okText : styles.bigYellow}>
                {altitudeText(deltaAlt)}
              </div>
              <div style={styles.metric}>Delta Alt: {formatDeg(deltaAlt)}</div>
            </div>
          </div>
        )}

        <div style={styles.lockGrid}>
          <span style={azLock ? styles.greenBadge : styles.redBadge}>
            Azimut {azLock ? "OK" : "NO"}
          </span>
          <span style={altLock ? styles.greenBadge : styles.redBadge}>
            Altezza {altLock ? "OK" : "NO"}
          </span>
        </div>
      </section>

      <section style={styles.card}>
        <label style={styles.label}>Seleziona target</label>
        <select
          style={styles.select}
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Osservazione Pro</h2>

        <p style={styles.smallText}>
          Migliori target astronomici nelle prossime 6 ore, calcolati solo da
          posizione, ora e altezza sull’orizzonte.
        </p>

        {observationPlan.length === 0 ? (
          <p style={styles.smallText}>Attendo GPS e dati astronomici...</p>
        ) : (
          <div style={styles.planList}>
            {observationPlan.slice(0, 5).map((item) => (
              <button
                key={item.id}
                style={{
                  ...styles.planItem,
                  ...(item.id === selectedId ? styles.selectedPlanItem : {}),
                }}
                onClick={() => setSelectedId(item.id)}
              >
                <div style={styles.planTop}>
                  <strong>{item.label}</strong>
                  <span
                    style={item.score >= 70 ? styles.ratingGood : styles.ratingWeak}
                  >
                    {item.rating}
                  </span>
                </div>

                <div style={styles.planGrid}>
                  <span>Ora top: {item.bestTime}</span>
                  <span>Alt max: {item.bestAltitude.toFixed(1)}°</span>
                  <span>Ora: {formatDeg(item.currentAltitude)}</span>
                  <span>Score: {item.score}/100</span>
                </div>

                <div style={styles.planAdvice}>{item.advice}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <span>Corpo</span>
          <span>Azimut</span>
          <span>Altezza</span>
          <span>Stato</span>
        </div>

        {rows.map((row) => (
          <button
            key={row.id}
            style={{
              ...styles.tableRow,
              ...(row.id === selectedId ? styles.selectedRow : {}),
            }}
            onClick={() => setSelectedId(row.id)}
          >
            <span>{row.label}</span>
            <span>{row.azimuth.toFixed(1)}°</span>
            <span>{row.altitude.toFixed(1)}°</span>
            <span style={row.visible ? styles.visible : styles.hidden}>
              {row.visible ? "Visibile" : "Sotto"}
            </span>
          </button>
        ))}
      </section>

      <section style={styles.arCard}>
        <h2 style={styles.sectionTitle}>AR Sky Overlay</h2>

        <p style={styles.smallText}>
          Camera posteriore + overlay target. Punta il telefono finché il marker
          entra nel mirino centrale.
        </p>

        {isStandalone && (
          <div style={styles.noticeBox}>
            Modalità App iPhone rilevata. Se la camera non parte, apri Astro
            Pons in Safari per AR completo.
          </div>
        )}

        <div style={styles.buttonRow}>
          <button style={styles.primaryButton} onClick={startCamera}>
            Avvia AR Camera
          </button>
          <button style={styles.secondaryButton} onClick={stopCamera}>
            Stop Camera
          </button>
        </div>

        {cameraError && <p style={styles.error}>{cameraError}</p>}

        <div style={styles.arFrame}>
          {cameraActive ? (
            <video ref={videoRef} playsInline muted style={styles.arVideo} />
          ) : (
            <div style={styles.cameraPlaceholder}>Camera non attiva</div>
          )}

          <div style={styles.arOverlay}>
            <div style={styles.reticle}>
              <div style={styles.reticleH} />
              <div style={styles.reticleV} />
            </div>

            {arMarker && (
              <div
                style={{
                  ...styles.marker,
                  ...(arMarker.inside ? {} : styles.markerOffscreen),
                  left: `${arMarker.x}%`,
                  top: `${arMarker.y}%`,
                }}
              >
                <div style={styles.markerDot} />
                <div style={styles.markerLabel}>
                  {selectedTarget?.label ?? "Target"}
                </div>
              </div>
            )}

            <div style={styles.arInstruction}>
              {targetLock ? (
                <span style={styles.arLockText}>✓ TARGET IN CAMERA</span>
              ) : (
                <>
                  <span>{directionText(deltaAz)}</span>
                  <span>{altitudeText(deltaAlt)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={styles.arInfoGrid}>
          <div style={styles.arMiniMetric}>Delta Az {formatDeg(deltaAz)}</div>
          <div style={styles.arMiniMetric}>Delta Alt {formatDeg(deltaAlt)}</div>
          <div style={styles.arMiniMetric}>
            Marker {arMarker?.inside ? "nel frame" : "fuori frame"}
          </div>
        </div>
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.infoBox}>
      <div style={styles.infoLabel}>{label}</div>
      <div style={styles.infoValue}>{value}</div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#05081f",
    color: "#f3f5ff",
    padding: "28px 16px 48px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
  header: {
    textAlign: "center",
    marginBottom: 24,
  },
  title: {
    color: "#ffd400",
    fontSize: 42,
    lineHeight: 1,
    margin: "0 0 10px",
    fontWeight: 900,
  },
  subtitle: {
    color: "#a9adbd",
    fontSize: 18,
    margin: 0,
    fontWeight: 700,
  },
  statusCard: {
    background: "#1b203a",
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    textAlign: "center",
    color: "#e6e8f2",
    fontSize: 16,
  },
  card: {
    background: "#1b203a",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
  },
  lockCard: {
    background: "#102b21",
    border: "2px solid #15ff31",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 0 30px rgba(21,255,49,0.12)",
  },
  sectionTitle: {
    margin: "0 0 16px",
    fontSize: 22,
    color: "#ffffff",
    textAlign: "center",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  infoBox: {
    background: "#11162c",
    borderRadius: 12,
    padding: 12,
  },
  infoLabel: {
    color: "#9ca3b7",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 4,
  },
  infoValue: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: 800,
  },
  buttonRow: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
    marginTop: 16,
  },
  primaryButton: {
    background: "#00b7ff",
    color: "#00111a",
    border: 0,
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 18,
    fontWeight: 900,
  },
  yellowButton: {
    background: "#ffd400",
    color: "#090909",
    border: 0,
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 18,
    fontWeight: 900,
  },
  secondaryButton: {
    background: "#707070",
    color: "#ffffff",
    border: 0,
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 18,
    fontWeight: 900,
  },
  targetName: {
    textAlign: "center",
    fontSize: 25,
    marginBottom: 14,
    color: "#ffffff",
  },
  lockText: {
    color: "#15ff31",
    textAlign: "center",
    fontSize: 42,
    fontWeight: 1000,
    margin: "18px 0",
  },
  precisionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 14,
  },
  directionBox: {
    background: "#11162c",
    borderRadius: 14,
    padding: 16,
    textAlign: "center",
  },
  bigYellow: {
    color: "#ffd400",
    fontSize: 30,
    fontWeight: 1000,
    lineHeight: 1.1,
  },
  okText: {
    color: "#15ff31",
    fontSize: 28,
    fontWeight: 1000,
    lineHeight: 1.1,
  },
  metric: {
    color: "#a9adbd",
    fontSize: 17,
    fontWeight: 800,
    marginTop: 8,
  },
  lockGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginTop: 16,
  },
  greenBadge: {
    background: "rgba(21,255,49,0.12)",
    color: "#15ff31",
    padding: 10,
    borderRadius: 10,
    textAlign: "center",
    fontWeight: 900,
  },
  redBadge: {
    background: "rgba(255,92,92,0.12)",
    color: "#ff6666",
    padding: 10,
    borderRadius: 10,
    textAlign: "center",
    fontWeight: 900,
  },
  label: {
    display: "block",
    fontSize: 18,
    fontWeight: 900,
    marginBottom: 10,
  },
  select: {
    width: "100%",
    background: "#1b203a",
    color: "#ffffff",
    border: "2px solid #00b7ff",
    borderRadius: 12,
    padding: 15,
    fontSize: 18,
    fontWeight: 800,
  },
  tableCard: {
    background: "#11162c",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 18,
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
    gap: 8,
    padding: "14px 12px",
    background: "#1b203a",
    color: "#ffffff",
    fontWeight: 900,
    fontSize: 15,
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
    gap: 8,
    width: "100%",
    padding: "16px 12px",
    background: "transparent",
    border: 0,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    color: "#e8eaf5",
    fontSize: 16,
    fontWeight: 800,
    textAlign: "left",
  },
  selectedRow: {
    background: "#303755",
  },
  visible: {
    color: "#15ff31",
  },
  hidden: {
    color: "#ff6666",
  },
  smallText: {
    color: "#a9adbd",
    fontSize: 15,
    lineHeight: 1.4,
  },
  planList: {
    display: "grid",
    gap: 12,
    marginTop: 14,
  },
  planItem: {
    background: "#11162c",
    color: "#f3f5ff",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 14,
    textAlign: "left",
  },
  selectedPlanItem: {
    border: "1px solid rgba(255,212,0,0.65)",
    boxShadow: "0 0 24px rgba(255,212,0,0.12)",
  },
  planTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 22,
    marginBottom: 10,
  },
  planGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    color: "#c8ccda",
    fontSize: 14,
    fontWeight: 800,
  },
  planAdvice: {
    marginTop: 10,
    color: "#ffd400",
    fontWeight: 800,
    fontSize: 14,
    lineHeight: 1.35,
  },
  ratingGood: {
    color: "#15ff31",
    fontSize: 14,
    fontWeight: 1000,
  },
  ratingWeak: {
    color: "#ffcc66",
    fontSize: 14,
    fontWeight: 1000,
  },
  arCard: {
    background: "#10162d",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    border: "1px solid rgba(0,183,255,0.35)",
  },
  noticeBox: {
    background: "rgba(255,212,0,0.12)",
    color: "#ffd400",
    border: "1px solid rgba(255,212,0,0.35)",
    borderRadius: 12,
    padding: 12,
    fontWeight: 800,
    marginBottom: 12,
    lineHeight: 1.4,
  },
  arFrame: {
    position: "relative",
    marginTop: 16,
    background: "#000",
    borderRadius: 18,
    overflow: "hidden",
    minHeight: 360,
    border: "2px solid rgba(255,255,255,0.12)",
  },
  arVideo: {
    width: "100%",
    height: 420,
    display: "block",
    objectFit: "cover",
  },
  cameraPlaceholder: {
    height: 420,
    display: "grid",
    placeItems: "center",
    color: "#8d93aa",
    fontWeight: 900,
    fontSize: 18,
  },
  arOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  },
  reticle: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 96,
    height: 96,
    transform: "translate(-50%, -50%)",
    border: "2px solid rgba(255,255,255,0.75)",
    borderRadius: "50%",
    boxShadow: "0 0 24px rgba(255,255,255,0.25)",
  },
  reticleH: {
    position: "absolute",
    left: -28,
    right: -28,
    top: "50%",
    height: 2,
    background: "rgba(255,255,255,0.75)",
  },
  reticleV: {
    position: "absolute",
    top: -28,
    bottom: -28,
    left: "50%",
    width: 2,
    background: "rgba(255,255,255,0.75)",
  },
  marker: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    display: "grid",
    placeItems: "center",
    gap: 6,
  },
  markerOffscreen: {
    opacity: 0.75,
  },
  markerDot: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "4px solid #ffd400",
    boxShadow: "0 0 24px rgba(255,212,0,0.9)",
    background: "rgba(255,212,0,0.15)",
  },
  markerLabel: {
    color: "#ffd400",
    fontSize: 15,
    fontWeight: 1000,
    textShadow: "0 2px 8px rgba(0,0,0,0.9)",
  },
  arInstruction: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    display: "grid",
    gap: 6,
    background: "rgba(0,0,0,0.65)",
    borderRadius: 14,
    padding: 14,
    color: "#ffd400",
    fontSize: 22,
    fontWeight: 1000,
    textAlign: "center",
  },
  arLockText: {
    color: "#15ff31",
    fontSize: 24,
    fontWeight: 1000,
  },
  arInfoGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8,
    marginTop: 12,
  },
  arMiniMetric: {
    background: "#11162c",
    borderRadius: 10,
    padding: 10,
    color: "#e8eaf5",
    fontWeight: 900,
    textAlign: "center",
  },
  error: {
    color: "#ff6666",
    fontWeight: 800,
    marginTop: 12,
  },
};
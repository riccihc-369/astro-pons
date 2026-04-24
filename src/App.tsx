import { useEffect, useState, useRef } from "react";
import {
  Body,
  Observer,
  Equator,
  Horizon,
} from "astronomy-engine";

type CelestialBody = {
  name: string;
  bodyType: Body;
  azimuth: number;
  altitude: number;
};

type DeviceOrientationEventWithWebkit = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type OrientationSample = {
  heading: number;
  pitch: number; // inclinazione avanti/indietro
  roll: number;  // inclinazione laterale
};

type WindowWithPermission = Window & {
  DeviceOrientationEvent?: {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
};

// Normalizza un angolo tra -180 e 180
function normalizeAngle(deg: number): number {
  let n = deg % 360;
  if (n > 180) n -= 360;
  if (n < -180) n += 360;
  return n;
}

export default function App() {
  const [bodies, setBodies] = useState<CelestialBody[]>([]);
  const [selectedBody, setSelectedBody] = useState<string>("Moon");
  const [latitude, setLatitude] = useState<number>(0);
  const [longitude, setLongitude] = useState<number>(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(0);
  const [gpsError, setGpsError] = useState<string>("");
  // Precision Mode: heading smoothing, pitch/tilt
  const [heading, setHeading] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(0);
  const [roll, setRoll] = useState<number>(0);
  const headingSamples = useRef<OrientationSample[]>([]);
  const [compassError, setCompassError] = useState<string>("");
  const [compassActive, setCompassActive] = useState(false);
  const [offset, setOffset] = useState<number>(0);
  const [status, setStatus] = useState("Avvio...");

  const gpsWatchIdRef = useRef<number | null>(null);
  const astronomyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceOrientationRef = useRef<boolean>(false);

  // Carica offset calibrazione da localStorage
  useEffect(() => {
    const savedOffset = localStorage.getItem("astroPons.compassOffsetDeg");
    if (savedOffset) {
      setOffset(parseFloat(savedOffset));
    }
  }, []);

  // Configura GPS con watchPosition (high accuracy)
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocalizzazione non disponibile");
      return;
    }

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setGpsAccuracy(pos.coords.accuracy);
        setGpsError("");
      },
      (err) => {
        let errMsg = "Errore GPS";
        if (err.code === 1) errMsg = "GPS negato";
        if (err.code === 2) errMsg = "Posizione non disponibile";
        if (err.code === 3) errMsg = "Timeout GPS";
        setGpsError(errMsg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => {
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, []);

  // Calcola corpi celesti ogni 5 secondi
  useEffect(() => {
    const calculateBodies = () => {
      if (!latitude || !longitude) return;

      const now = new Date();
      const observer = new Observer(latitude, longitude, 0);

      const bodyList = [
        { name: "Sole", type: Body.Sun },
        { name: "Luna", type: Body.Moon },
        { name: "Mercurio", type: Body.Mercury },
        { name: "Venere", type: Body.Venus },
        { name: "Marte", type: Body.Mars },
        { name: "Giove", type: Body.Jupiter },
        { name: "Saturno", type: Body.Saturn },
      ];

      const calculated = bodyList.map(({ name, type }) => {
        const eq = Equator(type, now, observer, true, true);
        const hor = Horizon(now, observer, eq.ra, eq.dec, "normal");

        return {
          name,
          bodyType: type,
          azimuth: hor.azimuth,
          altitude: hor.altitude,
        };
      });

      setBodies(calculated);
    };

    calculateBodies();
    astronomyIntervalRef.current = setInterval(calculateBodies, 5000);

    return () => {
      if (astronomyIntervalRef.current) {
        clearInterval(astronomyIntervalRef.current);
      }
    };
  }, [latitude, longitude]);

  // Listener per DeviceOrientationEvent con smoothing e pitch/roll
  useEffect(() => {
    if (!compassActive) return;

    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      const evt = event as DeviceOrientationEventWithWebkit;
      let rawHeading: number | undefined;
      // Preferisci webkitCompassHeading (iOS Safari)
      if (evt.webkitCompassHeading !== undefined) {
        rawHeading = evt.webkitCompassHeading;
      } else if (evt.alpha !== undefined) {
        rawHeading = evt.alpha;
      }
      // Pitch: inclinazione avanti/indietro (beta)
      // Roll: inclinazione laterale (gamma)
      const rawPitch = evt.beta !== undefined ? evt.beta : 0;
      const rawRoll = evt.gamma !== undefined ? evt.gamma : 0;

      if (typeof rawHeading === "number") {
        // Aggiorna buffer
        headingSamples.current.push({ heading: rawHeading, pitch: rawPitch, roll: rawRoll });
        if (headingSamples.current.length > 10) headingSamples.current.shift();
        // Calcola media mobile
        const avg = headingSamples.current.reduce(
          (acc, s) => {
            acc.heading += s.heading;
            acc.pitch += s.pitch;
            acc.roll += s.roll;
            return acc;
          },
          { heading: 0, pitch: 0, roll: 0 }
        );
        const n = headingSamples.current.length;
        setHeading(avg.heading / n);
        setPitch(avg.pitch / n);
        setRoll(avg.roll / n);
      }
    };

    window.addEventListener("deviceorientation", handleDeviceOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleDeviceOrientation);
      headingSamples.current = [];
    };
  }, [compassActive]);

  // Attiva bussola (con permesso su iOS/Safari)
  const activateCompass = async () => {
    const win = window as WindowWithPermission;

    // Se su iOS/Safari e requestPermission disponibile
    if (
      win.DeviceOrientationEvent &&
      win.DeviceOrientationEvent.requestPermission
    ) {
      try {
        const permission = await win.DeviceOrientationEvent.requestPermission();
        if (permission === "granted") {
          setCompassActive(true);
          deviceOrientationRef.current = true;
          setCompassError("");
        } else {
          setCompassError("Permesso orientamento negato");
        }
      } catch (err) {
        setCompassError("Errore richiesta permesso orientamento");
      }
    } else {
      // Per browser non iOS che supportano deviceorientation
      setCompassActive(true);
      deviceOrientationRef.current = true;
      setCompassError("");
    }
  };

  // Calibra sulla Luna
  const calibrateOnMoon = () => {
    if (typeof heading !== "number" || isNaN(heading)) {
      setCompassError("Heading non disponibile");
      return;
    }

    const moonData = bodies.find((b) => b.name === "Luna");
    if (!moonData) {
      setCompassError("Luna non trovata");
      return;
    }

    const calculatedOffset = moonData.azimuth - heading;
    const normalizedOffset = normalizeAngle(calculatedOffset);

    setOffset(normalizedOffset);
    localStorage.setItem(
      "astroPons.compassOffsetDeg",
      normalizedOffset.toString()
    );
  };

  // Reset calibrazione
  const resetCalibration = () => {
    setOffset(0);
    localStorage.removeItem("astroPons.compassOffsetDeg");
  };

  // Calcola heading corretto applicando offset
  const correctedHeading = heading + offset;

  // Calcola delta azimut e delta elevazione (pitch)
  const selectedBodyData = bodies.find((b) => b.name === selectedBody);
  // delta azimut
  const deltaAz = selectedBodyData
    ? normalizeAngle(selectedBodyData.azimuth - correctedHeading)
    : 0;
  // delta elevazione
  const deltaEl = selectedBodyData
    ? selectedBodyData.altitude - pitch
    : 0;

  // Precision Mode: indicazione telescopio
  const getTelescopeIndicator = () => {
    if (!selectedBodyData) return "";
    const lock = Math.abs(deltaAz) < 1 && Math.abs(deltaEl) < 1;
    if (lock) return "🎯 LOCK";
    let arrow = "";
    if (Math.abs(deltaAz) >= 1) arrow += deltaAz > 0 ? "← " : "→ ";
    if (Math.abs(deltaEl) >= 1) arrow += deltaEl > 0 ? "⬆" : "⬇";
    return arrow.trim();
  };

  // Status complessivo
  useEffect(() => {
    const parts: string[] = [];
    if (latitude && longitude) {
      parts.push(
        `Lat ${latitude.toFixed(4)} / Lon ${longitude.toFixed(4)}`
      );
      if (gpsAccuracy) parts.push(`(±${gpsAccuracy.toFixed(0)}m)`);
    }
    if (gpsError) parts.push(`GPS: ${gpsError}`);
    parts.push(`Heading: ${heading.toFixed(1)}°`);
    parts.push(`Pitch: ${pitch.toFixed(1)}°`);
    parts.push(`Tilt: ${roll.toFixed(1)}°`);
    if (compassError) parts.push(`Bussola: ${compassError}`);
    setStatus(parts.join(" | "));
  }, [latitude, longitude, gpsAccuracy, gpsError, heading, pitch, roll, compassError]);

  return (
    <div
      style={{
        backgroundColor: "#0a0e27",
        color: "#e0e0e0",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: "16px",
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      {/* Titolo */}
      <h1 style={{ margin: "0 0 8px 0", fontSize: "28px", color: "#ffd700" }}>
        Moon Compass
      </h1>
      <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#999" }}>
        V2.1 - Astronomical Compass
      </p>

      {/* Status */}
      <div
        style={{
          backgroundColor: "#1a1f3a",
          padding: "12px",
          borderRadius: "8px",
          marginBottom: "16px",
          fontSize: "12px",
          lineHeight: "1.4",
        }}
      >
        {status}
      </div>

      {/* Controlli Bussola */}
      {!compassActive && (
        <button
          onClick={activateCompass}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "16px",
            backgroundColor: "#00a8e8",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Attiva Bussola
        </button>
      )}

      {/* Sezione Calibrazione (visibile solo se bussola attiva) */}
      {compassActive && (
        <div
          style={{
            backgroundColor: "#1a1f3a",
            padding: "12px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <div style={{ marginBottom: "8px", fontSize: "13px" }}>
            <strong>Heading:</strong> {heading.toFixed(1)}°
          </div>
          <div style={{ marginBottom: "8px", fontSize: "13px" }}>
            <strong>Offset Calibrazione:</strong> {offset.toFixed(1)}°
          </div>
          {selectedBodyData && (
            <>
              <div style={{ marginBottom: "8px", fontSize: "13px" }}>
                <strong>Azimut {selectedBody}:</strong>{" "}
                {selectedBodyData.azimuth.toFixed(1)}°
              </div>
              <div style={{ marginBottom: "12px", fontSize: "13px" }}>
                <strong>Heading Corretto:</strong> {correctedHeading?.toFixed(1)}°
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <button
              onClick={calibrateOnMoon}
              style={{
                flex: 1,
                padding: "10px",
                backgroundColor: "#ffd700",
                color: "#000",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Calibra su Luna
            </button>
            <button
              onClick={resetCalibration}
              style={{
                flex: 1,
                padding: "10px",
                backgroundColor: "#666",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Target Selezionato e Indicazione Telescopio */}
      {compassActive && selectedBodyData && (
        <div
          style={{
            backgroundColor: "#1a1f3a",
            padding: "16px",
            borderRadius: "8px",
            marginBottom: "16px",
            textAlign: "center",
          }}
        >
          <div style={{ marginBottom: "12px" }}>
            <strong style={{ fontSize: "16px" }}>Target: {selectedBody}</strong>
          </div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: "bold",
              color:
                Math.abs(deltaAz) < 1 && Math.abs(deltaEl) < 1
                  ? "#00ff00"
                  : "#ffd700",
              marginBottom: "8px",
              letterSpacing: "2px",
            }}
          >
            {getTelescopeIndicator()}
          </div>
          {selectedBodyData && (
            <div style={{ fontSize: "12px", color: "#999" }}>
              ΔAz: {deltaAz.toFixed(1)}° | ΔEl: {deltaEl.toFixed(1)}°
            </div>
          )}
        </div>
      )}

      {/* Selezione Target */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "block", marginBottom: "8px", fontSize: "13px" }}>
          <strong>Seleziona Target:</strong>
        </label>
        <select
          value={selectedBody}
          onChange={(e) => setSelectedBody(e.target.value)}
          style={{
            width: "100%",
            padding: "10px",
            backgroundColor: "#1a1f3a",
            color: "#e0e0e0",
            border: "1px solid #00a8e8",
            borderRadius: "6px",
            fontSize: "14px",
          }}
        >
          {bodies.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tabella Corpi Celesti */}
      <div
        style={{
          overflowX: "auto",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "13px",
          }}
        >
          <thead>
            <tr style={{ backgroundColor: "#1a1f3a" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px",
                  borderBottom: "1px solid #333",
                }}
              >
                Corpo
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "10px",
                  borderBottom: "1px solid #333",
                }}
              >
                Azimut
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "10px",
                  borderBottom: "1px solid #333",
                }}
              >
                Altezza
              </th>
              <th
                style={{
                  textAlign: "center",
                  padding: "10px",
                  borderBottom: "1px solid #333",
                  fontSize: "12px",
                }}
              >
                Stato
              </th>
            </tr>
          </thead>
          <tbody>
            {bodies.map((body) => (
              <tr
                key={body.name}
                style={{
                  backgroundColor: body.name === selectedBody ? "#2a3050" : "transparent",
                  borderBottom: "1px solid #222",
                }}
              >
                <td style={{ padding: "10px" }}>{body.name}</td>
                <td style={{ textAlign: "right", padding: "10px" }}>
                  {body.azimuth.toFixed(1)}°
                </td>
                <td style={{ textAlign: "right", padding: "10px" }}>
                  {body.altitude.toFixed(1)}°
                </td>
                <td
                  style={{
                    textAlign: "center",
                    padding: "10px",
                    color:
                      body.altitude > 0 ? "#00ff00" : "#ff6b6b",
                  }}
                >
                  {body.altitude > 0 ? "Visibile" : "Sotto"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "24px",
          padding: "12px",
          fontSize: "11px",
          color: "#666",
          textAlign: "center",
          borderTop: "1px solid #333",
        }}
      >
        Usa GPS reale + bussola iPhone per puntare i corpi celesti
      </div>
    </div>
  );
}
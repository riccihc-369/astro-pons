import { useEffect, useState } from "react";
import {
  Body,
  Observer,
  Equator,
  Horizon,
} from "astronomy-engine";

type PlanetRow = {
  name: string;
  azimuth: string;
  altitude: string;
};

export default function App() {
  const [rows, setRows] = useState<PlanetRow[]>([]);
  const [status, setStatus] = useState("Attendo GPS...");

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        setStatus(`Lat ${lat.toFixed(4)} / Lon ${lon.toFixed(4)}`);

        const now = new Date();
        const observer = new Observer(lat, lon, 0);

        const bodies = [
          Body.Sun,
          Body.Moon,
          Body.Mercury,
          Body.Venus,
          Body.Mars,
          Body.Jupiter,
          Body.Saturn,
        ];

        const data = bodies.map((body) => {
          const eq = Equator(body, now, observer, true, true);
          const hor = Horizon(now, observer, eq.ra, eq.dec, "normal");

          return {
            name: Body[body],
            azimuth: hor.azimuth.toFixed(1) + "°",
            altitude: hor.altitude.toFixed(1) + "°",
          };
        });

        setRows(data);
      },
      () => {
        setStatus("GPS non autorizzato");
      }
    );
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>Astro Pons</h1>
      <p>{status}</p>

      <table width="100%" cellPadding={8}>
        <thead>
          <tr>
            <th align="left">Corpo</th>
            <th align="left">Azimut</th>
            <th align="left">Altezza</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.azimuth}</td>
              <td>{r.altitude}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
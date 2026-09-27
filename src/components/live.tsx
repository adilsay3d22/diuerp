"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MapPin, Radio, ScanLine } from "lucide-react";
import { boardQr } from "@/app/actions.ts";
import { btn, inputCls } from "./ui";

type Bus = { trip_id: number; route: string; bus: string | null; direction: string; lat: number; lng: number; at: string; near?: string | null; eta?: number | null; delay_min: number | null };
type Stop = { name: string; lat: number | null; lng: number | null };
const CAMPUS: [number, number] = [23.8773, 90.3206]; // Daffodil Smart City, Ashulia
const token = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// TRN-U-6 / TRN-A-7: OpenStreetMap with bus positions refreshed every 15 seconds.
export function LiveMap({ stops = [], height = 360, rider = false }: { stops?: Stop[]; height?: number; rider?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [updated, setUpdated] = useState<string>("");
  const map = useRef<{ L: typeof import("leaflet"); m: import("leaflet").Map; layer: import("leaflet").LayerGroup } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const L = await import("leaflet");
      if (!alive || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(CAMPUS, 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(m);
      const pts = stops.filter((s) => s.lat != null).map((s) => [s.lat!, s.lng!] as [number, number]);
      if (pts.length) {
        L.polyline(pts, { color: token("--color-accent"), weight: 3, opacity: 0.5 }).addTo(m);
        stops.filter((s) => s.lat != null).forEach((s) => L.circleMarker([s.lat!, s.lng!], { radius: 5, color: token("--color-accent"), fillColor: token("--color-card"), fillOpacity: 1, weight: 2 }).bindTooltip(s.name).addTo(m));
        m.fitBounds(L.latLngBounds(pts).pad(0.2));
      }
      map.current = { L, m, layer: L.layerGroup().addTo(m) };
    })();
    return () => { alive = false; map.current?.m.remove(); map.current = null; };
  }, [stops]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await fetch("/api/live").then((x) => x.json()).catch(() => null);
      if (stop || !r) return;
      setBuses(r.buses ?? []);
      setUpdated(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    const c = map.current;
    if (!c) return;
    c.layer.clearLayers();
    for (const b of buses) {
      c.L.circleMarker([b.lat, b.lng], { radius: 9, color: token("--color-card"), weight: 3, fillColor: token("--color-brand-green"), fillOpacity: 1 })
        .bindTooltip(`Bus ${b.bus ?? "?"} · Route ${b.route}${b.delay_min ? ` · ${b.delay_min} min late` : ""}`, { permanent: !rider, direction: "top" }).addTo(c.layer);
    }
    if (rider && buses[0]) c.m.panTo([buses[0].lat, buses[0].lng]);
  }, [buses, rider]);

  const mine = buses[0];
  return (
    <div>
      {rider && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[0.9375rem]" aria-live="polite">
          <Radio aria-hidden size={16} className={mine ? "text-success" : "text-meta"} />
          {mine ? <>Bus {mine.bus} · {mine.near ?? "on the way"}{mine.eta != null && <b className="ml-1">· ETA {mine.eta} min</b>}</> : "Your bus is not sharing its location right now."}
        </p>
      )}
      <div ref={el} style={{ height }} className="overflow-hidden rounded-2xl bg-muted ring-1 ring-rule" role="img" aria-label={`Map showing ${buses.length} live bus${buses.length === 1 ? "" : "es"}`} />
      <p className="mt-2 text-[0.75rem] text-meta">{buses.length} bus{buses.length === 1 ? "" : "es"} sharing location{updated && ` · updated ${updated}`} · refreshes every 15 s</p>
    </div>
  );
}

// TRN-D-2: while a trip runs, the driver's phone shares its GPS position.
const noSubscribe = () => () => {};
export function TripTracker({ tripId }: { tripId: number }) {
  const [state, setState] = useState("Starting location sharing…");
  const supported = useSyncExternalStore(noSubscribe, () => "geolocation" in navigator, () => true);
  useEffect(() => {
    if (!supported) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(async (p) => {
      if (Date.now() - last < 15000) return;
      last = Date.now();
      const r = await fetch(`/api/trips/${tripId}/position`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed }) }).catch(() => null);
      setState(r?.ok ? `Sharing location · ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Could not send location; retrying.");
    }, (e) => setState(e.code === 1 ? "Allow location access so riders can see the bus." : "Waiting for GPS…"), { enableHighAccuracy: true, maximumAge: 10000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [tripId, supported]);
  return <p className="mt-3 flex items-center gap-2 rounded-xl bg-tint-green px-3.5 py-2.5 text-[0.8125rem] text-success ring-1 ring-inset ring-success/15" aria-live="polite"><MapPin aria-hidden size={15} />{supported ? state : "This phone cannot share location."}</p>;
}

type Detector = { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> };
// TRN-D-3: scan the rider's pass QR with the camera, or type the code.
export function QrBoarding({ tripId }: { tripId: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [code, setCode] = useState("");
  const submit = async (token: string) => {
    const r = await boardQr(tripId, token);
    setMsg({ ok: r.ok, text: r.ok ? `${r.name} boarded` : r.name });
  };
  const detector = () => (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  const toggle = () => {
    if (!on && !detector()) return setMsg({ ok: false, text: "This browser can't scan. Type the code under the rider's QR." });
    setOn(!on);
  };
  useEffect(() => {
    const BD = detector();
    if (!on || !BD) return;
    let stream: MediaStream | null = null, stop = false, seen = "";
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const d = new BD({ formats: ["qr_code"] });
        while (!stop) {
          const [hit] = await d.detect(video.current).catch(() => []);
          if (hit && hit.rawValue !== seen) { seen = hit.rawValue; await submit(hit.rawValue); }
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch { setMsg({ ok: false, text: "Camera not available." }); setOn(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return (
    <div className="mt-4 rounded-2xl border border-rule bg-muted p-3">
      <button type="button" onClick={toggle} className={btn(on ? "secondary" : "primary", "md") + " w-full"}><ScanLine aria-hidden size={16} />{on ? "Stop scanning" : "Scan pass QR"}</button>
      {on && <video ref={video} muted playsInline className="mt-3 aspect-square w-full rounded-lg bg-ink object-cover" />}
      <form onSubmit={(e) => { e.preventDefault(); if (code) submit(code); }} className="mt-3 flex gap-2">
        <label htmlFor={`code-${tripId}`} className="sr-only">Pass code</label>
        <input id={`code-${tripId}`} autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} placeholder="DIU-PASS-…" className={`${inputCls} num`} />
        <button className={btn("secondary")}>Board</button>
      </form>
      {msg && <p role="status" className={`mt-2 text-[0.875rem] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}

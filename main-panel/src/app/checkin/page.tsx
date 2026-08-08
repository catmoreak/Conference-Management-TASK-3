"use client";

import { useState, useEffect, useCallback } from "react";

type Event = {
  id: string;
  name: string;
  location: string | null;
  startDate: string | null;
};

type Presenter = {
  id: string;
  displayName: string;
  organization: string | null;
  title: string | null;
  presentationAssignments: {
    id: string;
    liveSession: {
      id: string;
      name: string;
      startsAt: string | null;
      room: { name: string } | null;
    } | null;
  }[];
};

type Step = "select-event" | "select-presenter" | "confirm" | "upload" | "complete";

const INACTIVITY_TIMEOUT = 60_000; // 60 seconds

export default function CheckinPage() {
  const [step, setStep] = useState<Step>("select-event");
  const [events, setEvents] = useState<Event[]>([]);
  const [presenters, setPresenters] = useState<Presenter[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedPresenter, setSelectedPresenter] = useState<Presenter | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState("");
  const [search, setSearch] = useState("");

  const reset = useCallback(() => {
    setStep("select-event");
    setSelectedEvent(null);
    setSelectedPresenter(null);
    setSelectedFile(null);
    setUploadResult(null);
    setError(null);
    setOrgFilter("");
    setSearch("");
  }, []);

  // Inactivity reset
  useEffect(() => {
    const timer = setTimeout(reset, INACTIVITY_TIMEOUT);
    const events = ["mousemove", "keydown", "click", "touchstart"];
    const refresh = () => {
      clearTimeout(timer);
    };
    events.forEach((e) => window.addEventListener(e, refresh));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, refresh));
    };
  }, [step, reset]);

  // Fetch events on mount
  useEffect(() => {
    fetch("/api/checkin")
      .then((r) => r.json())
      .then((data: { events: Event[] }) => setEvents(data.events ?? []))
      .catch(() => setError("Failed to load events."));
  }, []);

  // Fetch presenters when event selected
  useEffect(() => {
    if (!selectedEvent) return;
    fetch(`/api/checkin?eventId=${selectedEvent.id}`)
      .then((r) => r.json())
      .then((data: { presenters: Presenter[] }) => setPresenters(data.presenters ?? []))
      .catch(() => setError("Failed to load presenters."));
  }, [selectedEvent]);

  const organizations = [...new Set(presenters.map((p) => p.organization ?? "Other"))];

  const filteredPresenters = presenters.filter((p) => {
    const matchOrg = !orgFilter || (p.organization ?? "Other") === orgFilter;
    const matchSearch =
      !search ||
      p.displayName.toLowerCase().includes(search.toLowerCase()) ||
      (p.organization ?? "").toLowerCase().includes(search.toLowerCase());
    return matchOrg && matchSearch;
  });

  async function handleUpload() {
    if (!selectedFile || !selectedPresenter) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("presenterId", selectedPresenter.id);
      const res = await fetch("/api/checkin/upload", { method: "POST", body: formData });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setUploadResult(selectedFile.name);
      setStep("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Auto-clear after completion
  useEffect(() => {
    if (step !== "complete") return;
    const t = setTimeout(reset, 5000);
    return () => clearTimeout(t);
  }, [step, reset]);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "sans-serif" }}>
      
      {/* Header */}
      <div style={{ marginBottom: "2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1e293b" }}>Presentation Check-in</h1>
        <p style={{ fontSize: "1.25rem", color: "#64748b" }}>
          {step === "select-event" && "Step 1 — Select your event"}
          {step === "select-presenter" && "Step 2 — Select your name"}
          {step === "confirm" && "Step 3 — Confirm your details"}
          {step === "upload" && "Step 4 — Upload your materials"}
          {step === "complete" && "Upload complete!"}
        </p>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "1rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "1.125rem" }}>
          {error}
        </div>
      )}

      {/* Step 1 — Select Event */}
      {step === "select-event" && (
        <div style={{ width: "100%", maxWidth: "600px" }}>
          {events.length === 0 ? (
            <p style={{ textAlign: "center", color: "#64748b", fontSize: "1.25rem" }}>No active events found. Please ask staff for assistance.</p>
          ) : (
            events.map((event) => (
              <button key={event.id} onClick={() => { setSelectedEvent(event); setStep("select-presenter"); }}
                style={{ display: "block", width: "100%", padding: "1.5rem", marginBottom: "1rem", fontSize: "1.25rem", fontWeight: 600, background: "#fff", border: "2px solid #e2e8f0", borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
                {event.name}
                {event.location && <span style={{ display: "block", fontSize: "1rem", color: "#64748b", fontWeight: 400 }}>{event.location}</span>}
              </button>
            ))
          )}
        </div>
      )}

      {/* Step 2 — Select Presenter */}
      {step === "select-presenter" && (
        <div style={{ width: "100%", maxWidth: "700px" }}>
          <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <input placeholder="Search by name or organization" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, padding: "0.75rem 1rem", fontSize: "1.125rem", border: "2px solid #e2e8f0", borderRadius: "8px" }} />
            <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}
              style={{ padding: "0.75rem 1rem", fontSize: "1.125rem", border: "2px solid #e2e8f0", borderRadius: "8px" }}>
              <option value="">All Organizations</option>
              {organizations.map((org) => <option key={org} value={org}>{org}</option>)}
            </select>
          </div>
          <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
            {filteredPresenters.map((p) => (
              <button key={p.id} onClick={() => { setSelectedPresenter(p); setStep("confirm"); }}
                style={{ display: "block", width: "100%", padding: "1.25rem", marginBottom: "0.75rem", fontSize: "1.125rem", fontWeight: 600, background: "#fff", border: "2px solid #e2e8f0", borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
                {p.displayName}
                {p.organization && <span style={{ display: "block", fontSize: "1rem", color: "#64748b", fontWeight: 400 }}>{p.organization}</span>}
              </button>
            ))}
            {filteredPresenters.length === 0 && <p style={{ textAlign: "center", color: "#64748b", fontSize: "1.125rem" }}>No presenters found. Try a different search.</p>}
          </div>
          <button onClick={() => setStep("select-event")} style={{ marginTop: "1rem", padding: "0.75rem 1.5rem", fontSize: "1.125rem", background: "#f1f5f9", border: "none", borderRadius: "8px", cursor: "pointer" }}>← Back</button>
        </div>
      )}

      {/* Step 3 — Confirm */}
      {step === "confirm" && selectedPresenter && (
        <div style={{ width: "100%", maxWidth: "600px", background: "#fff", padding: "2rem", borderRadius: "16px", border: "2px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Please confirm your details</h2>
          <p style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}><strong>Name:</strong> {selectedPresenter.displayName}</p>
          {selectedPresenter.organization && <p style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}><strong>Organization:</strong> {selectedPresenter.organization}</p>}
          {selectedPresenter.title && <p style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}><strong>Title:</strong> {selectedPresenter.title}</p>}
          {selectedPresenter.presentationAssignments.map((a) => a.liveSession && (
            <p key={a.id} style={{ fontSize: "1.125rem", color: "#475569", marginBottom: "0.25rem" }}>
              📍 {a.liveSession.room?.name ?? "TBD"} — {a.liveSession.name}
              {a.liveSession.startsAt && ` at ${new Date(a.liveSession.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            </p>
          ))}
          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button onClick={() => setStep("upload")}
              style={{ flex: 1, padding: "1rem", fontSize: "1.25rem", fontWeight: 700, background: "#2563eb", color: "#fff", border: "none", borderRadius: "12px", cursor: "pointer", minHeight: "64px" }}>
              ✓ Yes, this is me
            </button>
            <button onClick={() => setStep("select-presenter")}
              style={{ padding: "1rem 1.5rem", fontSize: "1.125rem", background: "#f1f5f9", border: "none", borderRadius: "12px", cursor: "pointer" }}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Upload */}
      {step === "upload" && (
        <div style={{ width: "100%", maxWidth: "600px", background: "#fff", padding: "2rem", borderRadius: "16px", border: "2px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Select your presentation file</h2>
          <p style={{ fontSize: "1.125rem", color: "#64748b", marginBottom: "1.5rem" }}>Accepted formats: .pptx, .pdf. Maximum size: 200MB.</p>
          <input type="file" accept=".pptx,.pdf,.ppt"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            style={{ display: "block", width: "100%", padding: "1rem", fontSize: "1.125rem", border: "2px dashed #cbd5e1", borderRadius: "12px", marginBottom: "1.5rem", cursor: "pointer" }} />
          {selectedFile && <p style={{ fontSize: "1.125rem", color: "#475569", marginBottom: "1rem" }}>Selected: <strong>{selectedFile.name}</strong> ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)</p>}
          <div style={{ display: "flex", gap: "1rem" }}>
            <button onClick={handleUpload} disabled={!selectedFile || uploading}
              style={{ flex: 1, padding: "1rem", fontSize: "1.25rem", fontWeight: 700, background: selectedFile && !uploading ? "#16a34a" : "#94a3b8", color: "#fff", border: "none", borderRadius: "12px", cursor: selectedFile && !uploading ? "pointer" : "not-allowed", minHeight: "64px" }}>
              {uploading ? "Uploading..." : "⬆ Upload File"}
            </button>
            <button onClick={() => setStep("confirm")} disabled={uploading}
              style={{ padding: "1rem 1.5rem", fontSize: "1.125rem", background: "#f1f5f9", border: "none", borderRadius: "12px", cursor: "pointer" }}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* Step 5 — Complete */}
      {step === "complete" && (
        <div style={{ textAlign: "center", maxWidth: "600px" }}>
          <div style={{ fontSize: "5rem", marginBottom: "1rem" }}>✅</div>
          <h2 style={{ fontSize: "2rem", fontWeight: 700, color: "#16a34a", marginBottom: "1rem" }}>Upload Successful!</h2>
          <p style={{ fontSize: "1.25rem", color: "#475569", marginBottom: "0.5rem" }}><strong>{uploadResult}</strong> has been received.</p>
          <p style={{ fontSize: "1.125rem", color: "#64748b" }}>This screen will reset in 5 seconds.</p>
        </div>
      )}
    </div>
  );
}
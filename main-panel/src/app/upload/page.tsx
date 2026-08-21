"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLanguage } from "~/app/_components/LanguageContext";

type Event = {
  id: string;
  name: string;
  location: string | null;
  startDate: string | null;
};

type SubmissionSummary = {
  id: string;
  status: string;
  fileName: string | null;
  reviewNote: string | null;
  createdAt: string;
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
  submissions: SubmissionSummary[];
};

type LiveSessionItem = {
  id: string;
  name: string;
  roomId?: string | null;
  room?: { id: string; name: string } | null;
};

type RoomItem = {
  id: string;
  name: string;
};

// Per-presenter upload state — tracked independently so concurrent
// uploads in different rows never clobber each other's feedback.
type UploadState = {
  status: "idle" | "uploading" | "success" | "error";
  fileName?: string;
  errorMessage?: string;
};

export default function PublicUploadPage() {
  const { lang, setLang } = useLanguage();

  // Cascading Selection State
  const [events, setEvents] = useState<Event[]>([]);
  const [presenters, setPresenters] = useState<Presenter[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-presenter upload states keyed by presenter id
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});

  // Hidden file inputs — one ref per presenter row
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Lists for dropdown options
  const [sessionsData, setSessionsData] = useState<LiveSessionItem[]>([]);
  const [roomsData, setRoomsData] = useState<RoomItem[]>([]);
  const [availableSessions, setAvailableSessions] = useState<{ id: string; name: string }[]>([]);
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);

  // Reset helper
  const resetSelection = useCallback(() => {
    setSelectedSessionId("");
    setSelectedRoom("");
    setSessionsData([]);
    setRoomsData([]);
    setAvailableSessions([]);
    setAvailableRooms([]);
    setPresenters([]);
    setUploadStates({});
  }, []);

  // Fetch all published events on mount
  useEffect(() => {
    setLoading(true);
    fetch("/api/checkin")
      .then((r) => r.json())
      .then((data: { events: Event[] }) => {
        setEvents(data.events ?? []);
      })
      .catch(() => setError("Failed to load events."))
      .finally(() => setLoading(false));
  }, []);

  // Fetch sessions, rooms, and presenters when event is selected
  useEffect(() => {
    if (!selectedEventId) {
      resetSelection();
      return;
    }

    setLoading(true);
    setError(null);
    fetch(`/api/checkin?eventId=${selectedEventId}`)
      .then((r) => r.json())
      .then((data: { presenters: Presenter[]; sessions?: LiveSessionItem[]; rooms?: RoomItem[] }) => {
        const fetchedPresenters = data.presenters ?? [];
        setPresenters(fetchedPresenters);

        const fetchedSessions = data.sessions ?? [];
        setSessionsData(fetchedSessions);

        const fetchedRooms = data.rooms ?? [];
        setRoomsData(fetchedRooms);
        // Populate room dropdown immediately from the rooms data
        setAvailableRooms(fetchedRooms.map((r) => r.name));
        
        // Auto-reset lower dropdowns when event changes
        setSelectedRoom("");
        setSelectedSessionId("");
        setAvailableSessions([]);
        setUploadStates({});
      })
      .catch(() => setError("Failed to load sessions and presenters."))
      .finally(() => setLoading(false));
  }, [selectedEventId, resetSelection]);

  // Filter sessions for the selected room
  useEffect(() => {
    if (!selectedRoom) {
      setSelectedSessionId("");
      setAvailableSessions([]);
      return;
    }

    // Find the room object by name to get its id
    const selectedRoomObj = roomsData.find((r) => r.name === selectedRoom);

    // Filter sessions that belong to the selected room
    let filteredSessions: { id: string; name: string }[];
    if (selectedRoomObj) {
      filteredSessions = sessionsData
        .filter((s) => s.roomId === selectedRoomObj.id || s.room?.id === selectedRoomObj.id)
        .map((s) => ({ id: s.id, name: s.name }));
    } else {
      // Fallback: show sessions with no room assigned
      filteredSessions = sessionsData
        .filter((s) => !s.roomId && !s.room)
        .map((s) => ({ id: s.id, name: s.name }));
    }

    // If no sessions matched, show all sessions (graceful fallback)
    if (filteredSessions.length === 0) {
      filteredSessions = sessionsData.map((s) => ({ id: s.id, name: s.name }));
    }

    setAvailableSessions(filteredSessions);

    // Auto-select session if single option
    if (filteredSessions.length === 1 && filteredSessions[0]) {
      setSelectedSessionId(filteredSessions[0].id);
    } else {
      setSelectedSessionId("");
    }
  }, [selectedRoom, sessionsData, roomsData]);

  // Filter presenters by session and room
  const filteredPresenters = presenters.filter((p) => {
    if (!selectedSessionId) return false;

    // 1. Explicitly assigned to this session
    const hasExplicitAssignment = p.presentationAssignments.some(
      (a) => a.liveSession?.id === selectedSessionId
    );
    if (hasExplicitAssignment) return true;

    // 2. Unassigned presenters in the event (allowed to select session on upload)
    const hasAnyAssignment = p.presentationAssignments.length > 0;
    if (!hasAnyAssignment) return true;

    return false;
  });

  // Set upload state for a single presenter without touching others
  function setPresenterUploadState(presenterId: string, state: UploadState) {
    setUploadStates((prev) => ({ ...prev, [presenterId]: state }));
  }

  // Trigger the hidden file input for a specific presenter row
  function triggerFileInput(presenterId: string) {
    fileInputRefs.current[presenterId]?.click();
  }

  // Handle file selection and upload for a specific presenter
  async function handleFileSelected(presenterId: string, file: File) {
    setPresenterUploadState(presenterId, { status: "uploading", fileName: file.name });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("presenterId", presenterId);
      formData.append("liveSessionId", selectedSessionId);

      const res = await fetch("/api/checkin/upload", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as { success?: boolean; error?: string; fileName?: string };

      if (!res.ok) {
        setPresenterUploadState(presenterId, {
          status: "error",
          fileName: file.name,
          errorMessage: data.error ?? (lang === "ja" ? "アップロードに失敗しました" : "Upload failed"),
        });
        return;
      }

      setPresenterUploadState(presenterId, {
        status: "success",
        fileName: data.fileName ?? file.name,
      });
    } catch {
      setPresenterUploadState(presenterId, {
        status: "error",
        fileName: file.name,
        errorMessage: lang === "ja" ? "アップロードに失敗しました" : "Upload failed",
      });
    }
  }

  return (
    <div style={{ minHeight: "100%", background: "#F8FAFC", padding: "1.5rem 2.5rem 2.5rem", fontFamily: "sans-serif", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      
      {/* Top Header with Brand Style and Language Switcher */}
      <div style={{ maxWidth: "1600px", width: "100%", margin: "0 auto 1.5rem auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", borderBottom: "1px solid #E2E8F0", paddingBottom: "1rem", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: "32px", fontWeight: 800, color: "#0B1220", marginBottom: "0.25rem", lineHeight: 1.2, letterSpacing: "-0.02em" }}>
            {lang === "ja" ? "発表資料アップロード" : "Presentation File Upload"}
          </h1>
          <p style={{ fontSize: "20px", color: "#64748B", margin: 0 }}>
            {lang === "ja" 
              ? "左側でイベント・セッション・会場を選択し、右側から発表者を選んでアップロードしてください。" 
              : "Select event, session, and room on the left, then upload slides for your name on the right."}
          </p>
        </div>

        {/* Language Switcher */}
        <div style={{ background: "#FFFFFF", border: "1px solid #CBD5E1", borderRadius: "12px", padding: "4px", display: "inline-flex", gap: "4px", boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)" }}>
          <button
            type="button"
            onClick={() => setLang("ja")}
            style={{
              padding: "0.5rem 1.5rem",
              fontSize: "20px",
              fontWeight: 700,
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              background: lang === "ja" ? "#0B1220" : "transparent",
              color: lang === "ja" ? "#FFFFFF" : "#64748B",
              transition: "all 0.15s ease",
            }}
          >
            日本語
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            style={{
              padding: "0.5rem 1.5rem",
              fontSize: "20px",
              fontWeight: 700,
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              background: lang === "en" ? "#0B1220" : "transparent",
              color: lang === "en" ? "#FFFFFF" : "#64748B",
              transition: "all 0.15s ease",
            }}
          >
            English
          </button>
        </div>
      </div>

      {error && (
        <div style={{ maxWidth: "1600px", width: "100%", margin: "0 auto 1rem auto", background: "#FEF2F2", color: "#B91C1C", padding: "1rem 1.5rem", borderRadius: "12px", fontSize: "20px", fontWeight: 600, border: "1px solid #FECACA", display: "flex", alignItems: "center", gap: "1rem", flexShrink: 0 }}>
          <svg style={{ width: "24px", height: "24px", flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div>
            <strong style={{ display: "block", marginBottom: "0.1rem" }}>{lang === "ja" ? "[エラー]" : "[Error]"}</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Main Body: Two-Column Split Layout */}
      <div style={{ maxWidth: "1600px", width: "100%", margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(420px, 480px) 1fr", gap: "2rem", flex: 1, minHeight: 0, alignItems: "stretch" }}>
        
        {/* Left Column: Selection Controls Panel */}
        <div style={{ background: "#FFFFFF", padding: "2rem 2rem 3rem 2rem", borderRadius: "16px", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.05)", display: "flex", flexDirection: "column", justifyContent: "flex-start", overflowY: "auto", maxHeight: "calc(100vh - 180px)" }}>
          <h2 style={{ fontSize: "32px", fontWeight: 700, color: "#0B1220", marginBottom: "1.75rem", lineHeight: 1.2, letterSpacing: "-0.01em" }}>
            {lang === "ja" ? "条件選択" : "Select Filters"}
          </h2>

          {/* Step 1: Event Selection */}
          <div style={{ marginBottom: "1.75rem" }}>
            <label style={{ display: "block", fontSize: "20px", fontWeight: 600, color: "#334155", marginBottom: "0.5rem" }}>
              {lang === "ja" ? "1. イベント" : "1. Event"}
            </label>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{ width: "100%", minHeight: "64px", padding: "0.85rem 1.25rem", fontSize: "20px", border: "1px solid #CBD5E1", borderRadius: "12px", backgroundColor: "#FFFFFF", color: "#0B1220", cursor: "pointer", outline: "none", lineHeight: 1.4 }}
            >
              <option value="">
                {lang === "ja" ? "— イベントを選択してください —" : "— Select an Event —"}
              </option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} {ev.location ? `(${ev.location})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Room Selection */}
          <div style={{ marginBottom: "1.75rem", opacity: selectedEventId ? 1 : 0.45, pointerEvents: selectedEventId ? "auto" : "none" }}>
            <label style={{ display: "block", fontSize: "20px", fontWeight: 600, color: "#334155", marginBottom: "0.5rem" }}>
              {lang === "ja" ? "2. 会場（部屋）" : "2. Room"}
            </label>
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              disabled={!selectedEventId}
              style={{ width: "100%", minHeight: "64px", padding: "0.85rem 1.25rem", fontSize: "20px", border: "1px solid #CBD5E1", borderRadius: "12px", backgroundColor: selectedEventId ? "#FFFFFF" : "#F8FAFC", color: "#0B1220", cursor: selectedEventId ? "pointer" : "not-allowed", outline: "none", lineHeight: 1.4 }}
            >
              <option value="">
                {lang === "ja" ? "— 会場を選択してください —" : "— Select a Room —"}
              </option>
              {availableRooms.map((room) => (
                <option key={room} value={room}>
                  {room}
                </option>
              ))}
            </select>
          </div>

          {/* Step 3: Session Selection */}
          <div style={{ marginBottom: "1.5rem", opacity: selectedRoom ? 1 : 0.45, pointerEvents: selectedRoom ? "auto" : "none" }}>
            <label style={{ display: "block", fontSize: "20px", fontWeight: 600, color: "#334155", marginBottom: "0.5rem" }}>
              {lang === "ja" ? "3. セッション" : "3. Session"}
            </label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              disabled={!selectedRoom}
              style={{ width: "100%", minHeight: "64px", padding: "0.85rem 1.25rem", fontSize: "20px", border: "1px solid #CBD5E1", borderRadius: "12px", backgroundColor: selectedRoom ? "#FFFFFF" : "#F8FAFC", color: "#0B1220", cursor: selectedRoom ? "pointer" : "not-allowed", outline: "none", lineHeight: 1.4 }}
            >
              <option value="">
                {lang === "ja" ? "— セッションを選択してください —" : "— Select a Session —"}
              </option>
              {availableSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right Column: Presenters Panel */}
        <div style={{ background: "#FFFFFF", padding: "2rem", borderRadius: "16px", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.05)", display: "flex", flexDirection: "column", minHeight: 0, height: "100%", maxHeight: "calc(100vh - 180px)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexShrink: 0 }}>
            <h2 style={{ fontSize: "32px", fontWeight: 700, color: "#0B1220", margin: 0, lineHeight: 1.2, letterSpacing: "-0.01em" }}>
              {lang === "ja" ? "発表者一覧" : "Presenters"}
            </h2>
            {selectedEventId && selectedSessionId && selectedRoom && filteredPresenters.length > 0 && (
              <span style={{ fontSize: "18px", color: "#64748B", fontWeight: 600, background: "#F1F5F9", padding: "0.35rem 0.85rem", borderRadius: "8px" }}>
                {filteredPresenters.length} {lang === "ja" ? "名" : "Presenter(s)"}
              </span>
            )}
          </div>
          
          {/* Dedicated Internal Scroll Container for Presenters List */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.5rem" }}>
            {!selectedEventId || !selectedSessionId || !selectedRoom ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748B", textAlign: "center", padding: "2rem" }}>
                
                {/* Pointer Indicator Box */}
                <div style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem", background: "#F1F5F9", border: "1px solid #E2E8F0", padding: "0.85rem 1.5rem", borderRadius: "14px", marginBottom: "1.25rem", color: "#0B1220", fontWeight: 700, fontSize: "20px" }}>
                  <svg style={{ width: "24px", height: "24px", transform: "rotate(180deg)" }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                  <span>{lang === "ja" ? "左側の条件を選択してください" : "Select options on the left"}</span>
                </div>

                <p style={{ fontSize: "20px", color: "#64748B", maxWidth: "440px", lineHeight: 1.5, margin: 0 }}>
                  {lang === "ja" 
                    ? "イベント・セッション・会場を指定すると、該当する発表者一覧がここに表示されます。" 
                    : "Choose your event, session, and room on the left panel to load the list of presenters."}
                </p>
              </div>
            ) : loading ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ textAlign: "center", color: "#64748B", fontSize: "20px" }}>
                  {lang === "ja" ? "読み込み中..." : "Loading..."}
                </p>
              </div>
            ) : filteredPresenters.length === 0 ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
                <div style={{ width: "100%", textAlign: "center", color: "#64748B", fontSize: "20px", background: "#F8FAFC", borderRadius: "12px", border: "1px dashed #CBD5E1", padding: "3rem 2rem" }}>
                  {lang === "ja" ? "このセッション・会場に該当する発表者が見つかりません。" : "No presenters found for this session and room."}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", paddingBottom: "1rem" }}>
                {filteredPresenters.map((p) => {
                  const us = uploadStates[p.id] ?? { status: "idle" };
                  const isUploading = us.status === "uploading";
                  const justUploaded = us.status === "success";
                  const isError = us.status === "error";

                  // Existing submission from database record
                  const existingSubmission = p.submissions?.[0];
                  const hasExisting = Boolean(existingSubmission?.fileName);
                  const isApproved = existingSubmission?.status === "approved";
                  const isRejected = existingSubmission?.status === "rejected";

                  // Whether the presenter already has an uploaded file on record (either just uploaded or previously)
                  const hasFile = justUploaded || hasExisting;
                  const currentFileName = justUploaded ? us.fileName : existingSubmission?.fileName;

                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: "1.5rem 1.75rem",
                        background: "#FFFFFF",
                        border: `1px solid ${hasFile ? "#10B981" : isError ? "#EF4444" : isRejected ? "#F59E0B" : "#E2E8F0"}`,
                        borderRadius: "14px",
                        boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1.5rem", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: 1, minWidth: "200px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "24px", fontWeight: 700, color: "#0B1220" }}>
                              {p.displayName}
                            </span>
                            
                            {/* Explicit Status Badges */}
                            {justUploaded && (
                              <span style={{ padding: "0.25rem 0.75rem", background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0", borderRadius: "6px", fontSize: "16px", fontWeight: 700 }}>
                                ✓ {lang === "ja" ? "アップロード完了" : "Upload Complete"}
                              </span>
                            )}
                            {!justUploaded && isApproved && (
                              <span style={{ padding: "0.25rem 0.75rem", background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0", borderRadius: "6px", fontSize: "16px", fontWeight: 700 }}>
                                ✓ {lang === "ja" ? "承認済み (アップロード完了)" : "Approved (Uploaded)"}
                              </span>
                            )}
                            {!justUploaded && hasExisting && !isApproved && !isRejected && (
                              <span style={{ padding: "0.25rem 0.75rem", background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0", borderRadius: "6px", fontSize: "16px", fontWeight: 700 }}>
                                ✓ {lang === "ja" ? "アップロード済み" : "Uploaded"}
                              </span>
                            )}
                            {!justUploaded && isRejected && (
                              <span style={{ padding: "0.25rem 0.75rem", background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A", borderRadius: "6px", fontSize: "16px", fontWeight: 700 }}>
                                ⚠️ {lang === "ja" ? "再提出が必要" : "Re-upload Required"}
                              </span>
                            )}
                            {isError && (
                              <span style={{ padding: "0.25rem 0.75rem", background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "16px", fontWeight: 700 }}>
                                ⚠️ {lang === "ja" ? "エラー" : "Error"}
                              </span>
                            )}
                          </div>
                          {p.organization && (
                            <span style={{ fontSize: "20px", color: "#64748B" }}>
                              {p.organization}
                            </span>
                          )}
                        </div>

                        {/* Hidden file input — keyed per presenter */}
                        <input
                          ref={(el) => { fileInputRefs.current[p.id] = el; }}
                          type="file"
                          accept=".pptx,.pptm,.ppt,.pdf"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void handleFileSelected(p.id, file);
                          }}
                        />

                        {/* Action Button: Clearly indicates "Uploaded" state when slides exist */}
                        <button
                          disabled={isUploading || isApproved}
                          onClick={() => triggerFileInput(p.id)}
                          style={{
                            height: "64px",
                            minHeight: "64px",
                            padding: "0 1.75rem",
                            fontSize: "24px",
                            fontWeight: 700,
                            background: isUploading 
                              ? "#94A3B8" 
                              : isApproved
                                ? "#059669"
                                : hasFile 
                                  ? "#059669" 
                                  : "#0B1220",
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: "12px",
                            cursor: isUploading ? "not-allowed" : isApproved ? "default" : "pointer",
                            whiteSpace: "nowrap",
                            boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
                            transition: "background 0.15s ease",
                            minWidth: "220px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "0.5rem",
                          }}
                          onMouseOver={(e) => { 
                            if (!isUploading && !isApproved) {
                              e.currentTarget.style.background = hasFile ? "#047857" : "#1E293B"; 
                            }
                          }}
                          onMouseOut={(e) => { 
                            if (!isUploading && !isApproved) {
                              e.currentTarget.style.background = hasFile ? "#059669" : "#0B1220"; 
                            }
                          }}
                        >
                          {isUploading ? (
                            <span>{lang === "ja" ? "アップロード中…" : "Uploading…"}</span>
                          ) : isApproved ? (
                            <>
                              <svg style={{ width: "22px", height: "22px" }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                              <span>{lang === "ja" ? "受領・承認済み" : "Approved"}</span>
                            </>
                          ) : hasFile ? (
                            <>
                              <svg style={{ width: "22px", height: "22px" }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                              <span>{lang === "ja" ? "アップロード済み (再送)" : "Uploaded (Re-upload)"}</span>
                            </>
                          ) : (
                            <span>{lang === "ja" ? "アップロード" : "Upload"}</span>
                          )}
                        </button>
                      </div>

                      {/* Per-row status confirmation feedback */}
                      {hasFile && (
                        <div style={{ marginTop: "1rem", padding: "0.85rem 1.25rem", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: "10px", color: "#065F46", fontSize: "20px", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.75rem" }}>
                          <svg style={{ width: "22px", height: "22px", color: "#059669", flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          <span>
                            <strong>{lang === "ja" ? "登録済みファイル: " : "Registered File: "}</strong>
                            {currentFileName ? `「${currentFileName}」` : (lang === "ja" ? "受領済み" : "Received")}
                          </span>
                        </div>
                      )}

                      {/* Rejection Note if staff requested changes */}
                      {!justUploaded && isRejected && existingSubmission?.reviewNote && (
                        <div style={{ marginTop: "1rem", padding: "0.85rem 1.25rem", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "10px", color: "#92400E", fontSize: "20px", fontWeight: 600 }}>
                          <strong>{lang === "ja" ? "修正理由: " : "Reason: "}</strong>
                          {existingSubmission.reviewNote}
                        </div>
                      )}

                      {/* Error feedback */}
                      {isError && (
                        <div style={{ marginTop: "1rem", padding: "1rem 1.25rem", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "10px", color: "#991B1B", fontSize: "20px", fontWeight: 600 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                            <svg style={{ width: "22px", height: "22px", color: "#DC2626", flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                            </svg>
                            <span>
                              <strong>{lang === "ja" ? "エラー: " : "Error: "}</strong>
                              {us.errorMessage}
                            </span>
                          </div>
                          <button
                            onClick={() => triggerFileInput(p.id)}
                            style={{
                              height: "64px",
                              minHeight: "64px",
                              padding: "0 2rem",
                              fontSize: "24px",
                              fontWeight: 700,
                              background: "#DC2626",
                              color: "#FFFFFF",
                              border: "none",
                              borderRadius: "10px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: "0.5rem",
                            }}
                          >
                            {lang === "ja" ? "再試行" : "Retry"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

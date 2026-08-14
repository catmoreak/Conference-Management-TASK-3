"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type Language = "en" | "ja";

export const LANG_STORAGE_KEY = "main_panel_lang";

export const translations = {
  en: {
    // Navigation & TopBar
    brand: "Podium",
    console: "Console",
    platform: "Platform",
    searchPlaceholder: "Search participants...",
    signOut: "Sign out",
    presenterModeHint: "Podium Presenter Mode",
    nav: {
      accounts: "Accounts",
      activeSessions: "Active Sessions",
      clients: "Clients",
      events: "Events",
      auditLogs: "Audit Logs",
      files: "Files",
    },
    pageTitles: {
      accounts: "Account Management",
      activeSessions: "Active Sessions",
      clients: "Client Management",
      events: "Event Management",
      auditLogs: "Audit Logs",
      files: "File Manager",
      staff: "Staff Dashboard",
      presOps: "Presentation Operations",
      dashboard: "Dashboard",
      checkin: "Reception & Check-in",
      podium: "Podium Console",
    },
    roles: {
      admin: "ADMINISTRATOR",
      reviewer: "REVIEWER / STAFF",
      presenter: "PRESENTER",
    },

    // Common buttons & actions
    actions: {
      save: "Save",
      cancel: "Cancel",
      delete: "Delete",
      edit: "Edit",
      upload: "Upload",
      add: "Add",
      filter: "Filter",
      search: "Search",
      back: "Back",
      login: "Login",
      verifying: "Verifying...",
      verifyCode: "Verify Code",
      signingIn: "Signing in...",
      view: "View",
      download: "Download",
      rename: "Rename",
      close: "Close",
      confirm: "Confirm",
      refresh: "Refresh",
      create: "Create",
      actions: "Actions",
      select: "Select",
    },

    // Auth & Login
    auth: {
      welcomeBack: "Welcome back",
      signInSub: "Sign in to your account",
      heroTitle: "Seamless presentation delivery for your events",
      heroSub: "Manage speaker slides, monitor live sessions, and drive podium displays in real time.",
      feature1: "Live session slide control",
      feature2: "Real-time display syncing",
      feature3: "Speaker material uploads",
      feature4: "Presentation audit logging",
      emailLabel: "Email",
      passwordLabel: "Password",
      verificationCodeLabel: "Verification Code",
      mfaHelp: "Enter the 6-digit TOTP code from your authenticator application.",
      backToSignIn: "Back to Sign In",
      applyForOrganizer: "Apply for Organizer Account",
      invalidCreds: "Invalid email or password.",
      suspendedAccount: "Account is suspended.",
      unexpectedError: "An unexpected error occurred.",
      mfaFailed: "MFA validation failed.",
    },

    // Dashboard Admin
    adminDashboard: {
      title: "Administrator Dashboard",
      welcomeDesc: "Welcome to the Podium admin console. Authorized checks are validated on each action.",
      sessionDetails: "SESSION DETAILS",
      authorizedName: "AUTHORIZED NAME",
      assignedRole: "ASSIGNED PRIVILEGE ROLE",
      signOutBtn: "Sign Out",
    },

    // Staff / Reviewer Dashboard
    staffDashboard: {
      title: "Staff & Reviewer Console",
      subTitle: "Review presentation materials, check speaker readiness, and manage session slides.",
      uploadSectionTitle: "Upload & Verify Slides",
      searchPlaceholder: "Filter by session or speaker...",
      allSessions: "All Sessions",
      statusAll: "All Statuses",
      statusApproved: "Approved",
      statusPending: "Pending Review",
      statusRejected: "Rejected",
      fileName: "File Name",
      session: "Session",
      speaker: "Speaker",
      status: "Status",
      uploadedAt: "Uploaded At",
      approve: "Approve",
      reject: "Reject",
      noFiles: "No presentation files submitted yet.",
    },

    // Presenter Operations Dashboard
    presOpsDashboard: {
      title: "Presentation Operations",
      subTitle: "Live slide control deck and podium display monitor.",
      activeSession: "Active Session",
      selectSession: "— Select Active Session —",
      displayStatus: "Podium Display Status",
      connected: "Connected",
      disconnected: "Disconnected",
      currentSlide: "Current Slide",
      nextSlide: "Next Slide",
      previousSlide: "Previous Slide",
      startPresentation: "Start Presentation",
      stopPresentation: "Stop Presentation",
      blankScreen: "Blank Screen",
      unblankScreen: "Unblank Screen",
      speakerNotes: "Speaker Notes",
      noNotes: "No speaker notes for this slide.",
    },

    // File Manager
    filesPage: {
      title: "Presentation File Manager",
      subTitle: "Upload, reorder, rename, and manage presentation slides across live sessions.",
      uploadDropzone: "Click or drag files here to upload presentation decks (.pptx, .ppt, .pdf)",
      uploading: "Uploading file...",
      filterBySession: "Filter by session...",
      addCoverSlide: "Add Cover Slide",
      coverPlaceholder: "Enter cover slide text (e.g. Event Name)",
      addCoverBtn: "Add Cover",
      tableHeaderFile: "File / Slide",
      tableHeaderSize: "Size",
      tableHeaderType: "Type",
      tableHeaderUploadedBy: "Uploaded By",
      tableHeaderSession: "Session",
      tableHeaderActions: "Actions",
      noFilesFound: "No files found for this filter.",
      deleteConfirm: "Are you sure you want to delete this file?",
      coverSlide: "Cover Slide",
    },

    // Admin Accounts Management
    accountsPage: {
      title: "Account Management",
      subTitle: "Manage administrator, reviewer, and presenter user credentials and roles.",
      createUser: "Create New User",
      name: "Name",
      email: "Email",
      role: "Role",
      status: "Status",
      twoFactor: "2FA Enabled",
      created: "Created",
      resetPassword: "Reset Password",
      suspend: "Suspend",
      unsuspend: "Unsuspend",
      active: "Active",
      suspended: "Suspended",
      modalTitle: "Add New User",
      modalNameLabel: "Full Name",
      modalEmailLabel: "Email Address",
      modalPasswordLabel: "Temporary Password",
      modalRoleLabel: "Assigned Role",
    },

    // Admin Active Sessions
    sessionsPage: {
      title: "Active Sessions",
      subTitle: "Monitor active presentation sessions and live display endpoints.",
      sessionName: "Session Name",
      event: "Event",
      room: "Room",
      displayClients: "Display Clients",
      status: "Status",
      active: "Live",
      idle: "Idle",
      disconnectAll: "Disconnect Display",
      viewFiles: "View Files",
      noSessions: "No active sessions configured.",
    },

    // Admin Clients Management
    clientsPage: {
      title: "Client Display Management",
      subTitle: "Registered podium screens and presentation client hardware.",
      clientName: "Client Device Name",
      ipAddress: "IP Address",
      pairingCode: "Pairing Code",
      lastSeen: "Last Seen",
      status: "Status",
      online: "Online",
      offline: "Offline",
      revokeToken: "Revoke Access",
      registerClient: "Register New Client",
      noClients: "No clients registered.",
    },

    // Admin Events Management
    eventsPage: {
      title: "Event Management",
      subTitle: "Schedule events, assign rooms, and manage presenter timetables.",
      createEvent: "Create Event",
      eventName: "Event Name",
      startDate: "Start Date",
      endDate: "End Date",
      location: "Location / Venue",
      sessionsCount: "Sessions",
      managePresenters: "Presenters",
      manageRooms: "Rooms",
      manageSessions: "Sessions",
      noEvents: "No events scheduled.",
    },

    // Audit Logs Page
    auditLogsPage: {
      title: "Audit Logs",
      subTitle: "Track system authentication, file changes, and live control activities.",
      timestamp: "Timestamp",
      user: "User",
      action: "Action",
      target: "Target",
      ipAddress: "IP Address",
      details: "Details",
      searchLogs: "Search audit logs...",
      noLogs: "No audit log entries recorded.",
    },

    // Reception & Check-in
    checkinPage: {
      title: "Reception & Attendee Check-in",
      subTitle: "Verify attendee registrations and print attendee badges.",
      selectEvent: "— Select Event —",
      searchAttendee: "Search attendee name or email...",
      checkInBtn: "Check In",
      checkedIn: "Checked In",
      printBadge: "Print Badge",
      noAttendees: "No attendees found matching search criteria.",
    },

    // Podium embedded page
    podiumPage: {
      title: "Podium Console Integration",
      subTitle: "Embedded podium display and presentation sync status.",
      openPodiumApp: "Open Standalone Podium App",
    },
  },

  ja: {
    // Navigation & TopBar
    brand: "Podium",
    console: "コンソール",
    platform: "プラットフォーム",
    searchPlaceholder: "参加者を検索...",
    signOut: "サインアウト",
    presenterModeHint: "ポディウム発表者モード",
    nav: {
      accounts: "アカウント管理",
      activeSessions: "アクティブセッション",
      clients: "クライアント端末",
      events: "イベント管理",
      auditLogs: "監査ログ",
      files: "ファイル管理",
    },
    pageTitles: {
      accounts: "アカウント管理",
      activeSessions: "アクティブセッション",
      clients: "クライアント端末管理",
      events: "イベント管理",
      auditLogs: "監査ログ",
      files: "ファイルマネージャー",
      staff: "スタッフダッシュボード",
      presOps: "プレゼンテーション操作",
      dashboard: "ダッシュボード",
      checkin: "受付・チェックイン",
      podium: "ポディウムコンソール",
    },
    roles: {
      admin: "管理者",
      reviewer: "査読者 / スタッフ",
      presenter: "発表者",
    },

    // Common buttons & actions
    actions: {
      save: "保存",
      cancel: "キャンセル",
      delete: "削除",
      edit: "編集",
      upload: "アップロード",
      add: "追加",
      filter: "フィルター",
      search: "検索",
      back: "戻る",
      login: "ログイン",
      verifying: "確認中...",
      verifyCode: "コードを検証",
      signingIn: "サインイン中...",
      view: "表示",
      download: "ダウンロード",
      rename: "名前を変更",
      close: "閉じる",
      confirm: "確認",
      refresh: "更新",
      create: "新規作成",
      actions: "操作",
      select: "選択",
    },

    // Auth & Login
    auth: {
      welcomeBack: "おかえりなさい",
      signInSub: "アカウントにサインインしてください",
      heroTitle: "イベントのプレゼンテーション投影をシームレスに",
      heroSub: "発表者のスライド管理、ライブセッションの監視、ポディウム投影のリアルタイム制御。",
      feature1: "ライブセッションのスライド制御",
      feature2: "ディスプレイのリアルタイム同期",
      feature3: "発表者資料のアップロード機能",
      feature4: "プレゼンテーション監査ログ管理",
      emailLabel: "メールアドレス",
      passwordLabel: "パスワード",
      verificationCodeLabel: "認証コード",
      mfaHelp: "認証アプリに表示される6桁のTOTPコードを入力してください。",
      backToSignIn: "サインイン画面に戻る",
      applyForOrganizer: "主催者アカウントの申請",
      invalidCreds: "メールアドレスまたはパスワードが正しくありません。",
      suspendedAccount: "アカウントが停止されています。",
      unexpectedError: "予期しないエラーが発生しました。",
      mfaFailed: "MFA検証に失敗しました。",
    },

    // Dashboard Admin
    adminDashboard: {
      title: "管理者ダッシュボード",
      welcomeDesc: "Podium 管理コンソールへようこそ。すべての操作に対して認証チェックが行われます。",
      sessionDetails: "セッション詳細",
      authorizedName: "認証済みユーザー名",
      assignedRole: "割当済み権限ロール",
      signOutBtn: "サインアウト",
    },

    // Staff / Reviewer Dashboard
    staffDashboard: {
      title: "スタッフ・査読者コンソール",
      subTitle: "プレゼンテーション資料の確認、発表者の準備状態の管理、セッションスライドの承認を行います。",
      uploadSectionTitle: "スライドのアップロード・確認",
      searchPlaceholder: "セッションまたは発表者で検索...",
      allSessions: "すべてのセッション",
      statusAll: "すべてのステータス",
      statusApproved: "承認済み",
      statusPending: "確認待ち",
      statusRejected: "却下",
      fileName: "ファイル名",
      session: "セッション",
      speaker: "発表者",
      status: "ステータス",
      uploadedAt: "アップロード日時",
      approve: "承認",
      reject: "却下",
      noFiles: "提出されたプレゼンテーションファイルはありません。",
    },

    // Presenter Operations Dashboard
    presOpsDashboard: {
      title: "プレゼンテーション操作",
      subTitle: "スライドのライブ操作デッキとポディウム投影モニター。",
      activeSession: "アクティブセッション",
      selectSession: "— アクティブセッションを選択 —",
      displayStatus: "ポディウム投影ステータス",
      connected: "接続中",
      disconnected: "未接続",
      currentSlide: "現在のスライド",
      nextSlide: "次のスライド",
      previousSlide: "前のスライド",
      startPresentation: "プレゼンテーション開始",
      stopPresentation: "プレゼンテーション終了",
      blankScreen: "画面を非表示",
      unblankScreen: "画面を再表示",
      speakerNotes: "発表者ノート",
      noNotes: "このスライドには発表者ノートがありません。",
    },

    // File Manager
    filesPage: {
      title: "ファイルマネージャー",
      subTitle: "セッションごとのプレゼンテーションスライドのアップロード、並び替え、名前変更、管理を行います。",
      uploadDropzone: "ファイルをドラッグ＆ドロップまたはクリックしてアップロード (.pptx, .ppt, .pdf)",
      uploading: "ファイルをアップロード中...",
      filterBySession: "セッションで絞り込み...",
      addCoverSlide: "カバー slide を追加",
      coverPlaceholder: "カバースライドのテキストを入力 (例: イベント名)",
      addCoverBtn: "カバーを追加",
      tableHeaderFile: "ファイル / スライド",
      tableHeaderSize: "サイズ",
      tableHeaderType: "種類",
      tableHeaderUploadedBy: "アップロード者",
      tableHeaderSession: "セッション",
      tableHeaderActions: "操作",
      noFilesFound: "対象のファイルは見つかりませんでした。",
      deleteConfirm: "このファイルを削除してもよろしいですか？",
      coverSlide: "カバースライド",
    },

    // Admin Accounts Management
    accountsPage: {
      title: "アカウント管理",
      subTitle: "管理者、査読者、発表者のユーザーアカウントおよびロール権限を管理します。",
      createUser: "新規ユーザー作成",
      name: "氏名",
      email: "メールアドレス",
      role: "ロール",
      status: "ステータス",
      twoFactor: "2FA設定済み",
      created: "作成日時",
      resetPassword: "パスワードリセット",
      suspend: "アカウント停止",
      unsuspend: "停止解除",
      active: "有効",
      suspended: "停止中",
      modalTitle: "新規ユーザー追加",
      modalNameLabel: "氏名",
      modalEmailLabel: "メールアドレス",
      modalPasswordLabel: "仮パスワード",
      modalRoleLabel: "割当ロール",
    },

    // Admin Active Sessions
    sessionsPage: {
      title: "アクティブセッション",
      subTitle: "進行中のプレゼンテーションセッションおよびディスプレイ接続状態を監視します。",
      sessionName: "セッション名",
      event: "イベント",
      room: "会場・部屋",
      displayClients: "接続ディスプレイ数",
      status: "ステータス",
      active: "ライブ中",
      idle: "待機中",
      disconnectAll: "ディスプレイ切断",
      viewFiles: "ファイルを表示",
      noSessions: "アクティブなセッションはありません。",
    },

    // Admin Clients Management
    clientsPage: {
      title: "クライアント端末管理",
      subTitle: "登録済みポディウム画面およびプレゼンテーション表示端末の管理。",
      clientName: "端末名",
      ipAddress: "IPアドレス",
      pairingCode: "ペアリングコード",
      lastSeen: "最終確認日時",
      status: "ステータス",
      online: "オンライン",
      offline: "オフライン",
      revokeToken: "アクセス取消",
      registerClient: "新規端末の登録",
      noClients: "登録されているクライアント端末はありません。",
    },

    // Admin Events Management
    eventsPage: {
      title: "イベント管理",
      subTitle: "イベントのスケジューリング、会場の割り当て、発表者タイムテーブルの管理。",
      createEvent: "イベント作成",
      eventName: "イベント名",
      startDate: "開始日",
      endDate: "終了日",
      location: "開催場所 / 会場",
      sessionsCount: "セッション数",
      managePresenters: "発表者管理",
      manageRooms: "会場管理",
      manageSessions: "セッション管理",
      noEvents: "スケジュールされたイベントはありません。",
    },

    // Audit Logs Page
    auditLogsPage: {
      title: "監査ログ",
      subTitle: "システム認証、ファイル変更、ライブ制御アクティビティを追跡します。",
      timestamp: "タイムスタンプ",
      user: "ユーザー",
      action: "操作内容",
      target: "対象",
      ipAddress: "IPアドレス",
      details: "詳細",
      searchLogs: "監査ログを検索...",
      noLogs: "記録された監査ログはありません。",
    },

    // Reception & Check-in
    checkinPage: {
      title: "受付・チェックイン",
      subTitle: "参加者の登録状況を確認し、参加者バッジを発行します。",
      selectEvent: "— イベントを選択 —",
      searchAttendee: "参加者の氏名またはメールアドレスで検索...",
      checkInBtn: "チェックイン",
      checkedIn: "チェックイン済み",
      printBadge: "バッジ印刷",
      noAttendees: "該当する参加者が見つかりません。",
    },

    // Podium embedded page
    podiumPage: {
      title: "ポディウムコンソール統合",
      subTitle: "組み込みポディウムディスプレイとプレゼンテーション同期ステータス。",
      openPodiumApp: "スタンドアロンポディウムアプリを開く",
    },
  },
};

type TranslationDict = typeof translations.en;

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TranslationDict;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    const savedLang = localStorage.getItem(LANG_STORAGE_KEY) as Language | null;
    if (savedLang && (savedLang === "en" || savedLang === "ja")) {
      setLangState(savedLang);
    }
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem(LANG_STORAGE_KEY, newLang);
  };

  const t = translations[lang] ?? translations.en;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

"use client";

import React, { useState, useRef, useEffect } from "react";
import { 
  Github, 
  Upload, 
  Folder, 
  File, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Terminal as TerminalIcon,
  ChevronRight,
  AlertCircle,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Interface for File Log Entry
 */
interface LogEntry {
  id: string;
  path: string;
  status: "pending" | "success" | "error";
  message?: string;
  timestamp: string;
}

/**
 * Interface for Selected File
 */
interface SelectedFile {
  file: File;
  relativePath: string;
}

export default function GitHubFolderUploader() {
  // --- State Management ---
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [repo, setRepo] = useState("");
  const [repoMode, setRepoMode] = useState<"existing" | "create">("existing");
  const [isPrivate, setIsPrivate] = useState(false);
  const [targetPath, setTargetPath] = useState("");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Load credentials from LocalStorage on mount ---
  useEffect(() => {
    const savedToken = localStorage.getItem("gitfolder_token");
    const savedUsername = localStorage.getItem("gitfolder_username");
    if (savedToken) setToken(savedToken);
    if (savedUsername) setUsername(savedUsername);
  }, []);

  // --- Save credentials to LocalStorage when they change ---
  useEffect(() => {
    if (token) localStorage.setItem("gitfolder_token", token);
  }, [token]);

  useEffect(() => {
    if (username) localStorage.setItem("gitfolder_username", username);
  }, [username]);

  // --- Auto-scroll terminal to bottom ---
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  /**
   * Helper to convert File to Base64
   */
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  /**
   * Helper to create a new repository
   */
  const createRepository = async () => {
    const logId = Math.random().toString(36).substring(7);
    setLogs((prev) => [
      ...prev,
      {
        id: logId,
        path: `Creating repository: ${repo}`,
        status: "pending",
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    try {
      const response = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: repo,
          private: isPrivate,
          auto_init: false,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setLogs((prev) =>
          prev.map((log) =>
            log.id === logId
              ? {
                  ...log,
                  status: "success",
                  path: `✅ New Repository '${repo}' created successfully!`,
                }
              : log
          )
        );
        return true;
      } else {
        if (data.message === "Repository creation failed." && data.errors?.[0]?.message === "name already exists on this account") {
          throw new Error("❌ Repository already exists. Please switch to 'Existing Repository'.");
        }
        throw new Error(data.message || "Failed to create repository");
      }
    } catch (err: any) {
      setLogs((prev) =>
        prev.map((log) =>
          log.id === logId
            ? { ...log, status: "error", message: err.message }
            : log
        )
      );
      return false;
    }
  };

  /**
   * Robust path sanitization for Android SAF and other weird browser paths
   */
  const sanitizeFilePath = (path: string): string => {
    // 1. Decode URI components (handles %3A, %2F)
    let decodedPath = decodeURIComponent(path);
    
    // 2. Normalize slashes
    decodedPath = decodedPath.replace(/\\/g, "/");

    // 3. Handle Android SAF prefixes (tree/, document/, primary:, etc.)
    // If it's a SAF path, it usually has a colon
    if (decodedPath.includes(":")) {
      decodedPath = decodedPath.substring(decodedPath.lastIndexOf(":") + 1);
    }

    // 4. Remove leading/trailing slashes
    decodedPath = decodedPath.replace(/^\/+|\/+$/g, "");

    // 5. Split into segments and filter out system junk
    let segments = decodedPath.split("/");

    // Common Android system/virtual folder prefixes that aren't part of the real folder structure
    const systemFolders = [
      "tree", "document", "primary", "home", "storage", 
      "emulated", "0", "myfiles", "documents", "download",
      "raw", "msf", "external"
    ];
    
    // Intelligently strip system prefixes and numeric IDs
    while (segments.length > 1) {
      const first = segments[0].toLowerCase();
      // If it's a known system folder or just a numeric ID (common in SAF paths)
      if (systemFolders.includes(first) || /^\d+$/.test(first)) {
        segments.shift();
      } else {
        break;
      }
    }

    // 6. Remove the root folder name (e.g., "mflix_fixed") if it exists
    // webkitRelativePath usually starts with the selected folder's name
    if (segments.length > 1) {
      segments.shift();
    }

    return segments.join("/");
  };

  /**
   * Handle Folder Selection
   */
  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const fileList: SelectedFile[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const rawPath = file.webkitRelativePath || file.name;
      
      fileList.push({
        file,
        relativePath: sanitizeFilePath(rawPath),
      });
    }

    setFiles(fileList);
    setError(null);
    setLogs([]);
    setProgress(0);
    setSuccessCount(0);
    setShowSuccess(false);
  };

  /**
   * Core Upload Logic
   */
  const startUpload = async () => {
    const cleanToken = token.trim();
    const cleanUsername = username.trim();
    const cleanRepo = repo.trim();
    const cleanTargetPath = targetPath.trim().replace(/^\/+|\/+$/g, "");

    if (!cleanToken || !cleanUsername || !cleanRepo) {
      setError("Please fill in all required fields (Token, Username, Repo).");
      return;
    }

    if (files.length === 0) {
      setError("Please select a folder to upload.");
      return;
    }

    // Save trimmed values to localStorage
    localStorage.setItem("gitfolder_token", cleanToken);
    localStorage.setItem("gitfolder_username", cleanUsername);

    setIsUploading(true);
    setError(null);
    setLogs([]);
    setProgress(0);
    setSuccessCount(0);
    setShowSuccess(false);

    // --- 1. Validate Credentials & Repository ---
    try {
      setLogs([{
        id: "auth-check",
        path: "Verifying GitHub credentials and repository...",
        status: "pending",
        timestamp: new Date().toLocaleTimeString(),
      }]);

      const repoCheck = await fetch(`https://api.github.com/repos/${cleanUsername}/${cleanRepo}`, {
        headers: {
          Authorization: `token ${cleanToken}`,
          "Accept": "application/vnd.github.v3+json",
        },
      });

      if (repoCheck.status === 404) {
        if (repoMode === "existing") {
          throw new Error(`Repository '${cleanUsername}/${cleanRepo}' not found. Check if the name is correct or if it's a private repo that your token can't see.`);
        }
        // If in create mode, 404 is expected, but we should check if the token is valid by checking the user
        const userCheck = await fetch("https://api.github.com/user", {
          headers: { Authorization: `token ${cleanToken}` }
        });
        if (!userCheck.ok) throw new Error("Invalid GitHub Token. Please check your Personal Access Token.");
      } else if (!repoCheck.ok) {
        const data = await repoCheck.json();
        throw new Error(data.message || "Failed to connect to GitHub");
      }

      setLogs((prev) => prev.map(l => l.id === "auth-check" ? { ...l, status: "success", path: "Connection verified!" } : l));
    } catch (err: any) {
      setError(err.message);
      setIsUploading(false);
      setLogs([]);
      return;
    }

    // --- 2. Create Repository if needed ---
    if (repoMode === "create") {
      const created = await createRepository();
      if (!created) {
        setIsUploading(false);
        return;
      }
    }

    let currentSuccess = 0;

    // Sequential Uploading
    for (let i = 0; i < files.length; i++) {
      const { file, relativePath } = files[i];
      const logId = Math.random().toString(36).substring(7);
      
      const newLog: LogEntry = {
        id: logId,
        path: relativePath,
        status: "pending",
        timestamp: new Date().toLocaleTimeString(),
      };
      setLogs((prev) => [...prev, newLog]);

      try {
        const content = await fileToBase64(file);
        const fullPathInRepo = cleanTargetPath 
          ? `${cleanTargetPath}/${relativePath}` 
          : relativePath;
        
        const url = `https://api.github.com/repos/${cleanUsername}/${cleanRepo}/contents/${fullPathInRepo}`;

        const response = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `token ${cleanToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Upload ${relativePath} via GitFolder Uploader`,
            content: content,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          setLogs((prev) =>
            prev.map((log) =>
              log.id === logId ? { ...log, status: "success" } : log
            )
          );
          currentSuccess++;
          setSuccessCount(currentSuccess);
        } else {
          // Handle specific error cases
          let errorMsg = data.message || "Failed to upload";
          if (response.status === 404) errorMsg = "Path not found or Repo missing (404)";
          if (response.status === 401) errorMsg = "Unauthorized: Check your Token";
          if (data.message?.includes("already exists")) errorMsg = "File already exists in repo";
          
          throw new Error(errorMsg);
        }
      } catch (err: any) {
        setLogs((prev) =>
          prev.map((log) =>
            log.id === logId
              ? { ...log, status: "error", message: err.message }
              : log
          )
        );
      }

      const newProgress = Math.round(((i + 1) / files.length) * 100);
      setProgress(newProgress);
    }

    setIsUploading(false);
    if (currentSuccess === files.length) {
      setShowSuccess(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12 text-center">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/50 border border-zinc-800 mb-4"
          >
            <Github className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">GitHub API Integration</span>
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl font-bold tracking-tight mb-4 bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent"
          >
            GitFolder Uploader
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-zinc-400 text-lg max-w-2xl mx-auto"
          >
            Deploy entire local directories to your GitHub repositories with a single click. 
            Secure, sequential, and real-time.
          </motion.p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Configuration & Selection */}
          <div className="lg:col-span-5 space-y-6">
            {/* Config Card */}
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="p-6 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-xl shadow-2xl"
            >
              <div className="flex items-center gap-2 mb-6">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-semibold">Repository Details</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase mb-1.5 ml-1">Personal Access Token</label>
                  <input 
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    className="w-full bg-black/40 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-zinc-700"
                  />
                </div>

                {/* Repository Mode Toggle */}
                <div className="p-1 bg-black/40 border border-zinc-800 rounded-xl flex">
                  <button
                    onClick={() => setRepoMode("existing")}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium rounded-lg transition-all",
                      repoMode === "existing" 
                        ? "bg-zinc-800 text-white shadow-sm" 
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    Existing Repo
                  </button>
                  <button
                    onClick={() => setRepoMode("create")}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium rounded-lg transition-all",
                      repoMode === "create" 
                        ? "bg-zinc-800 text-white shadow-sm" 
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    Create New
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 uppercase mb-1.5 ml-1">Username</label>
                    <input 
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="octocat"
                      className="w-full bg-black/40 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-zinc-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 uppercase mb-1.5 ml-1">Repo Name</label>
                    <input 
                      type="text"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      placeholder="my-awesome-project"
                      className="w-full bg-black/40 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {repoMode === "create" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-zinc-200">Make Repository Private</span>
                          <span className="text-[10px] text-zinc-500">Only you can see this repository</span>
                        </div>
                        <button
                          onClick={() => setIsPrivate(!isPrivate)}
                          className={cn(
                            "w-10 h-5 rounded-full transition-colors relative",
                            isPrivate ? "bg-indigo-600" : "bg-zinc-800"
                          )}
                        >
                          <motion.div
                            animate={{ x: isPrivate ? 22 : 2 }}
                            className="absolute top-1 left-0 w-3 h-3 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase mb-1.5 ml-1">Target Path (Optional)</label>
                  <input 
                    type="text"
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                    placeholder="src/components"
                    className="w-full bg-black/40 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-zinc-700"
                  />
                </div>
              </div>
            </motion.div>

            {/* Folder Selection Card */}
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="p-6 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-xl shadow-2xl"
            >
              <div className="flex items-center gap-2 mb-6">
                <Folder className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-semibold">Folder Selection</h2>
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="group relative cursor-pointer"
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
                <div className="relative flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-2xl p-10 bg-black/40 group-hover:border-zinc-600 transition-colors">
                  <Upload className="w-10 h-10 text-zinc-600 mb-4 group-hover:text-indigo-400 transition-colors" />
                  <p className="text-sm text-zinc-400 font-medium">Click to select a folder</p>
                  <p className="text-xs text-zinc-600 mt-1">All subdirectories will be included</p>
                  <input 
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFolderSelect}
                    className="hidden"
                    // @ts-ignore - webkitdirectory is non-standard but widely supported
                    webkitdirectory=""
                    directory=""
                    multiple
                  />
                </div>
              </div>

              {files.length > 0 && (
                <div className="mt-4 flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <File className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm text-zinc-400">{files.length} files detected</span>
                  </div>
                  <button 
                    onClick={() => setFiles([])}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
            </motion.div>

            {/* Action Button */}
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              disabled={isUploading || files.length === 0}
              onClick={startUpload}
              className={cn(
                "w-full py-4 rounded-2xl font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-3",
                isUploading || files.length === 0
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white active:scale-[0.98]"
              )}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6" />
                  Start Upload
                </>
              )}
            </motion.button>

            {error && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{error}</p>
              </motion.div>
            )}
          </div>

          {/* Right Column: Progress & Logs */}
          <div className="lg:col-span-7 space-y-6">
            {/* Progress Card */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="p-6 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-xl shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h2 className="text-lg font-semibold">Upload Progress</h2>
                </div>
                <span className="text-sm font-mono text-indigo-400">{progress}%</span>
              </div>

              <div className="space-y-4">
                <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500"
                  />
                </div>
                <div className="flex justify-between text-xs text-zinc-500 font-medium uppercase tracking-wider">
                  <span>{successCount} of {files.length} files uploaded</span>
                  <span>{files.length - successCount - (isUploading ? 1 : 0)} remaining</span>
                </div>
              </div>

              {/* Success Section */}
              <AnimatePresence>
                {showSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center text-center gap-4"
                  >
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Upload Completed Successfully!</span>
                    </div>
                    <a
                      href={`https://github.com/${username}/${repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
                    >
                      <Github className="w-4 h-4" />
                      Open in GitHub
                    </a>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Terminal Card */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="flex flex-col h-[500px] rounded-2xl bg-black border border-zinc-800 overflow-hidden shadow-2xl"
            >
              {/* Terminal Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/50 border-bottom border-zinc-800">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="w-4 h-4 text-zinc-400" />
                  <span className="text-xs font-mono text-zinc-400">Live Log Terminal</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                </div>
              </div>

              {/* Terminal Body */}
              <div 
                ref={terminalRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-[13px] space-y-2 scrollbar-thin scrollbar-thumb-zinc-800"
              >
                {logs.length === 0 && !isUploading && (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-2">
                    <TerminalIcon className="w-8 h-8 opacity-20" />
                    <p>Waiting for upload to start...</p>
                  </div>
                )}
                
                <AnimatePresence initial={false}>
                  {logs.map((log) => (
                    <motion.div 
                      key={log.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-3 group"
                    >
                      <span className="text-zinc-600 shrink-0">[{log.timestamp}]</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {log.status === "pending" && <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />}
                          {log.status === "success" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                          {log.status === "error" && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                          
                          <span className={cn(
                            "truncate",
                            log.status === "pending" && "text-indigo-400",
                            log.status === "success" && "text-zinc-300",
                            log.status === "error" && "text-red-400"
                          )}>
                            {log.status === "pending" ? "Pending" : log.status === "success" ? "Success" : "Error"}
                          </span>
                          
                          <ChevronRight className="w-3 h-3 text-zinc-700" />
                          <span className="text-zinc-500 truncate">{log.path}</span>
                        </div>
                        {log.message && (
                          <p className="text-red-500/70 text-xs mt-1 ml-5 border-l border-red-500/20 pl-2">
                            {log.message}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-12 text-center border-t border-zinc-900 mt-12">
        <p className="text-zinc-600 text-sm">
          Built for developers who value speed. GitHub API v3.
        </p>
      </footer>
    </div>
  );
}

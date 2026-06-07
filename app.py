import json
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parent
SCRAPER = ROOT / "Scraper.js"


class ScraperApp(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("Website Scraper")
        self.geometry("1040x720")
        self.minsize(860, 580)

        self.process = None
        self.reader_thread = None
        self.events = queue.Queue()
        self.output_dir = None

        self.url_var = tk.StringVar(value="https://example.com")
        self.status_var = tk.StringVar(value="stopped")
        self.current_url_var = tk.StringVar(value="-")
        self.output_var = tk.StringVar(value="-")
        self.crawl_var = tk.BooleanVar(value=False)
        self.max_pages_var = tk.StringVar(value="75")
        self.profile_dir_var = tk.StringVar(value="")
        self.profile_name_var = tk.StringVar(value="")

        self._build_ui()
        self._set_running(False)
        self.after(100, self._drain_events)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self):
        self.columnconfigure(0, weight=0)
        self.columnconfigure(1, weight=1)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=(14, 12))
        top.grid(row=0, column=0, columnspan=2, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="Website URL").grid(row=0, column=0, sticky="w", padx=(0, 8))
        self.url_entry = ttk.Entry(top, textvariable=self.url_var)
        self.url_entry.grid(row=0, column=1, sticky="ew", padx=(0, 8))
        self.start_button = ttk.Button(top, text="Start", command=self.start_scraper)
        self.start_button.grid(row=0, column=2, sticky="e")

        options = ttk.Frame(top)
        options.grid(row=1, column=1, sticky="ew", pady=(8, 0), padx=(0, 8))
        options.columnconfigure(4, weight=1)
        self.crawl_check = ttk.Checkbutton(options, text="Full same-origin crawl", variable=self.crawl_var)
        self.crawl_check.grid(row=0, column=0, sticky="w", padx=(0, 12))
        ttk.Label(options, text="Max pages").grid(row=0, column=1, sticky="w", padx=(0, 6))
        self.max_pages_entry = ttk.Entry(options, textvariable=self.max_pages_var, width=8)
        self.max_pages_entry.grid(row=0, column=2, sticky="w", padx=(0, 12))
        ttk.Label(options, text="Chrome profile folder").grid(row=0, column=3, sticky="e", padx=(0, 6))
        self.profile_entry = ttk.Entry(options, textvariable=self.profile_dir_var)
        self.profile_entry.grid(row=0, column=4, sticky="ew")
        ttk.Label(options, text="Profile name").grid(row=1, column=3, sticky="e", padx=(0, 6), pady=(6, 0))
        self.profile_name_entry = ttk.Entry(options, textvariable=self.profile_name_var)
        self.profile_name_entry.grid(row=1, column=4, sticky="ew", pady=(6, 0))

        controls = ttk.Frame(self, padding=14)
        controls.grid(row=1, column=0, sticky="nsew")
        controls.columnconfigure(0, weight=1)

        self.scrape_button = ttk.Button(controls, text="Scrape Current Page", command=lambda: self.send_action("scrape"))
        self.scrape_button.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        self.next_button = ttk.Button(controls, text="Next Page", command=lambda: self.send_action("next"))
        self.next_button.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        self.finish_button = ttk.Button(controls, text="Finish", command=lambda: self.send_action("finish"))
        self.finish_button.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        self.stop_button = ttk.Button(controls, text="Stop", command=self.stop_scraper)
        self.stop_button.grid(row=3, column=0, sticky="ew", pady=(0, 18))

        ttk.Separator(controls).grid(row=4, column=0, sticky="ew", pady=(0, 14))

        self._info_row(controls, 5, "Status", self.status_var)
        self._info_row(controls, 6, "Current URL", self.current_url_var)
        self._info_row(controls, 7, "Output", self.output_var)

        self.open_output_button = ttk.Button(controls, text="Open Output Folder", command=self.open_output)
        self.open_output_button.grid(row=8, column=0, sticky="ew", pady=(18, 8))

        self.choose_button = ttk.Button(controls, text="Choose Existing Export", command=self.choose_output)
        self.choose_button.grid(row=9, column=0, sticky="ew")

        right = ttk.Notebook(self)
        right.grid(row=1, column=1, sticky="nsew", padx=(0, 14), pady=(0, 14))

        log_frame = ttk.Frame(right, padding=10)
        log_frame.rowconfigure(0, weight=1)
        log_frame.columnconfigure(0, weight=1)
        right.add(log_frame, text="Logs")

        self.log_text = tk.Text(log_frame, wrap="word", height=20, font=("Consolas", 10))
        self.log_text.grid(row=0, column=0, sticky="nsew")
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=log_scroll.set)

        log_buttons = ttk.Frame(log_frame)
        log_buttons.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(8, 0))
        ttk.Button(log_buttons, text="Clear Logs", command=lambda: self.log_text.delete("1.0", "end")).pack(side="right")

        pages_frame = ttk.Frame(right, padding=10)
        pages_frame.rowconfigure(0, weight=1)
        pages_frame.columnconfigure(0, weight=1)
        right.add(pages_frame, text="Saved Pages")

        columns = ("title", "url", "assets", "html")
        self.pages = ttk.Treeview(pages_frame, columns=columns, show="headings")
        self.pages.heading("title", text="Title")
        self.pages.heading("url", text="URL")
        self.pages.heading("assets", text="Assets")
        self.pages.heading("html", text="HTML File")
        self.pages.column("title", width=220, stretch=True)
        self.pages.column("url", width=300, stretch=True)
        self.pages.column("assets", width=70, stretch=False)
        self.pages.column("html", width=220, stretch=True)
        self.pages.grid(row=0, column=0, sticky="nsew")
        pages_scroll = ttk.Scrollbar(pages_frame, orient="vertical", command=self.pages.yview)
        pages_scroll.grid(row=0, column=1, sticky="ns")
        self.pages.configure(yscrollcommand=pages_scroll.set)

    def _info_row(self, parent, row, label, variable):
        frame = ttk.Frame(parent)
        frame.grid(row=row, column=0, sticky="ew", pady=(0, 10))
        frame.columnconfigure(0, weight=1)
        ttk.Label(frame, text=label).grid(row=0, column=0, sticky="w")
        value = ttk.Label(frame, textvariable=variable, wraplength=250, foreground="#4b5968")
        value.grid(row=1, column=0, sticky="ew", pady=(2, 0))

    def start_scraper(self):
        if self.process and self.process.poll() is None:
            messagebox.showinfo("Scraper running", "The scraper is already running.")
            return

        url = self.url_var.get().strip()
        if not url.startswith(("http://", "https://")):
            messagebox.showerror("Invalid URL", "Enter a URL starting with http:// or https://")
            return

        self._append_log("Starting scraper...")
        self.output_dir = None
        self.output_var.set("-")
        self.current_url_var.set(url)

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        command = ["node", str(SCRAPER), url]
        if self.crawl_var.get():
            command.append("--crawl")
        max_pages = self.max_pages_var.get().strip()
        if max_pages:
            command.extend(["--max-pages", max_pages])
        profile_dir = self.profile_dir_var.get().strip()
        if profile_dir:
            command.extend(["--profile", profile_dir])
            command.extend(["--browser-channel", "chrome"])
        profile_name = self.profile_name_var.get().strip()
        if profile_name:
            command.extend(["--profile-name", profile_name])

        self.process = subprocess.Popen(
            command,
            cwd=str(ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creationflags,
        )

        self._set_running(True)
        self.reader_thread = threading.Thread(target=self._read_process_output, daemon=True)
        self.reader_thread.start()

    def send_action(self, action):
        if not self.process or self.process.poll() is not None:
            self._append_log("Scraper is not running.")
            self._set_running(False)
            return

        labels = {
            "scrape": "Scraping current page...",
            "next": "Moving to next page...",
            "finish": "Finishing export...",
        }
        self._append_log(labels.get(action, action))
        self.process.stdin.write(json.dumps({"action": action}) + "\n")
        self.process.stdin.flush()

    def stop_scraper(self):
        if self.process and self.process.poll() is None:
            self._append_log("Stopping scraper...")
            self.process.terminate()
        self._set_running(False)

    def open_output(self):
        path = Path(self.output_dir) if self.output_dir else None
        if not path or not path.exists():
            messagebox.showinfo("No output yet", "Scrape at least one page first.")
            return
        os.startfile(path)

    def choose_output(self):
        selected = filedialog.askdirectory(initialdir=str(ROOT / "downloaded_site"))
        if selected:
            self.output_dir = selected
            self.output_var.set(selected)

    def _read_process_output(self):
        assert self.process and self.process.stdout
        for line in self.process.stdout:
            self.events.put(line.rstrip("\n"))
        code = self.process.wait()
        self.events.put({"type": "exit", "code": code})

    def _drain_events(self):
        while True:
            try:
                event = self.events.get_nowait()
            except queue.Empty:
                break
            self._handle_event(event)
        self.after(100, self._drain_events)

    def _handle_event(self, event):
        if isinstance(event, dict) and event.get("type") == "exit":
            self._append_log(f"Process exited with code {event['code']}")
            self._set_running(False)
            return

        if not isinstance(event, str) or not event:
            return

        try:
            data = json.loads(event)
        except json.JSONDecodeError:
            self._append_log(event)
            return

        event_type = data.get("type")
        if event_type == "state":
            self._apply_state(data)
        elif event_type == "page":
            self._add_page(data)
            self._apply_state(data)
        elif data.get("message"):
            self._append_log(data["message"])
        else:
            self._append_log(json.dumps(data, ensure_ascii=False))

    def _apply_state(self, data):
        if data.get("currentUrl"):
            self.current_url_var.set(data["currentUrl"])
        if data.get("outputDir"):
            self.output_dir = data["outputDir"]
            self.output_var.set(data["outputDir"])

    def _add_page(self, data):
        self.pages.insert(
            "",
            0,
            values=(
                data.get("title") or "Saved page",
                data.get("url") or "",
                data.get("assetCount") or 0,
                data.get("htmlFile") or "",
            ),
        )
        title = data.get("title") or data.get("url") or "Saved page"
        assets = data.get("assetCount") or 0
        self._append_log(f"Saved: {title} ({assets} assets)")

    def _append_log(self, message):
        self.log_text.insert("end", str(message) + "\n")
        self.log_text.see("end")

    def _set_running(self, running):
        self.status_var.set("running" if running else "stopped")
        for widget in (self.scrape_button, self.next_button, self.finish_button, self.stop_button):
            widget.configure(state="normal" if running else "disabled")
        self.start_button.configure(state="disabled" if running else "normal")
        self.url_entry.configure(state="disabled" if running else "normal")
        self.crawl_check.configure(state="disabled" if running else "normal")
        self.max_pages_entry.configure(state="disabled" if running else "normal")
        self.profile_entry.configure(state="disabled" if running else "normal")
        self.profile_name_entry.configure(state="disabled" if running else "normal")

    def _on_close(self):
        if self.process and self.process.poll() is None:
            if not messagebox.askyesno("Quit", "The scraper is still running. Stop it and close the app?"):
                return
            self.stop_scraper()
        self.destroy()


if __name__ == "__main__":
    app = ScraperApp()
    app.mainloop()

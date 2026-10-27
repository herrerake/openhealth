import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { onUnauthorized, uploadAppleBatch } from "@/lib/api";
import type { ParserMessage } from "../workers/appleParser";

type Phase = { kind: "idle" } | { kind: "working"; percent: number; sent: number } | { kind: "done"; records: number; seconds: number } | { kind: "error"; message: string };

export default function AppleUpload({ open, onOpenChange, onUploaded }: { open: boolean; onOpenChange: (open: boolean) => void; onUploaded: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const worker = useRef<Worker | null>(null);

  const start = (file: File) => {
    worker.current?.terminate();
    const w = new Worker(new URL("../workers/appleParser.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const uploadId = `${file.size}-${file.lastModified}`;
    let sent = 0;
    let percent = 0;
    let uploads = Promise.resolve();
    let failed = false;
    const fail = (message: string) => {
      if (failed) return;
      failed = true;
      w.terminate();
      setPhase({ kind: "error", message });
    };
    w.onerror = () => fail("Couldn't read that file in this browser. Try the export.zip from your iPhone.");
    setPhase({ kind: "working", percent: 0, sent: 0 });
    w.onmessage = (e: MessageEvent<ParserMessage>) => {
      const m = e.data;
      if (m.type === "progress") {
        percent = m.percent;
        setPhase({ kind: "working", percent, sent });
      } else if (m.type === "batch") {
        // Batches go up one at a time, in order, while parsing continues.
        uploads = uploads
          .then(async () => {
            if (failed) return;
            await uploadAppleBatch(uploadId, m.records);
            sent += m.records.length;
            setPhase({ kind: "working", percent, sent });
          })
          .catch((err) => {
            if (!onUnauthorized(err)) fail("Upload failed. Check your connection and try again.");
          });
      } else if (m.type === "done") {
        uploads.then(() => {
          if (!failed) setPhase({ kind: "done", records: m.records, seconds: Math.round(m.ms / 100) / 10 });
        });
        w.terminate();
      } else {
        fail(m.message);
      }
    };
    w.postMessage({ type: "parse", file });
  };

  const finish = () => {
    onOpenChange(false);
    setPhase({ kind: "idle" });
    onUploaded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload your Apple Health export</DialogTitle>
          <DialogDescription>Your export is read on this device. Only workouts, daily summaries and heart-rate averages are sent.</DialogDescription>
        </DialogHeader>
        <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
          <li>On your iPhone, open Health and tap your profile picture.</li>
          <li>Tap “Export All Health Data” and save the file.</li>
          <li>Choose the export.zip (or export.xml) below.</li>
        </ol>
        <div className="grid gap-2">
          <Label htmlFor="health-file">Health export file</Label>
          <Input
            id="health-file"
            type="file"
            accept=".zip,.xml"
            disabled={phase.kind === "working"}
            onChange={(e) => e.target.files?.[0] && start(e.target.files[0])}
          />
        </div>
        {phase.kind === "working" && (
          <div className="grid gap-2 text-sm">
            <Progress value={phase.percent} />
            <span className="text-muted-foreground">
              Reading your export… {phase.percent}%{phase.sent ? ` · ${phase.sent.toLocaleString("en-US")} records sent` : ""}
            </span>
          </div>
        )}
        {phase.kind === "done" && (
          <p className="text-sm font-medium">
            {phase.records.toLocaleString("en-US")} records in {phase.seconds.toFixed(1)} s
          </p>
        )}
        {phase.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {phase.message}
          </p>
        )}
        <DialogFooter>
          <Button disabled={phase.kind !== "done"} onClick={finish}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

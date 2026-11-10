import React, { useState } from "react";
import { wrapFeedbackForAgent } from "../utils/parser";
import { copyTextToClipboard } from "../utils/clipboard";
import { OverlayScrollArea } from "./OverlayScrollArea";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  annotationsOutput: string;
  annotationCount: number;
  /** Wrap the output for Copy the way the agent receives it. Default: plan-deny framing. */
  wrapCopiedAnnotations?: (feedback: string) => string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  annotationsOutput,
  annotationCount,
  wrapCopiedAnnotations = wrapFeedbackForAgent,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyAnnotations = async () => {
    if (await copyTextToClipboard(wrapCopiedAnnotations(annotationsOutput))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadAnnotations = () => {
    const url = URL.createObjectURL(new Blob([annotationsOutput], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "annotations.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div
        className="bg-card border border-border rounded-xl w-full max-w-2xl flex flex-col max-h-[80vh] shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-sm">Export</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {annotationCount} annotation{annotationCount !== 1 ? "s" : ""}
              </span>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <OverlayScrollArea className="flex-1 min-h-0">
          <div className="p-4">
            <pre className="bg-muted rounded-lg p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {annotationsOutput}
            </pre>
          </div>
        </OverlayScrollArea>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={handleCopyAnnotations}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={handleDownloadAnnotations}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Download Annotations
          </button>
        </div>
      </div>
    </div>
  );
};

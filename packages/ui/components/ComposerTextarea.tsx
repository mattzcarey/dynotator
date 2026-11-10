import React from "react";

/** The comment composer's textarea. */
export const ComposerTextarea: React.FC<{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  sizeClassName: string;
  textareaRef: (el: HTMLTextAreaElement | null) => void;
}> = ({ value, onChange, onKeyDown, placeholder, sizeClassName, textareaRef }) => (
  <textarea
    data-pn-mobile-editable="true"
    ref={textareaRef}
    value={value}
    onChange={onChange}
    onKeyDown={onKeyDown}
    placeholder={placeholder}
    className={`w-full bg-transparent text-sm px-1 py-0.5 placeholder:text-muted-foreground resize-none focus:outline-none ${sizeClassName}`}
    style={{ fieldSizing: "content" } as React.CSSProperties}
  />
);

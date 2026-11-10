import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { type Annotation, type Block, type ImageAttachment } from "@dynotator/ui/types";
import type { ViewerHandle } from "@dynotator/ui/components/Viewer";
import { useUndoHistory } from "@dynotator/ui/hooks/useUndoHistory";
import { annotationOwnsHighlight } from "@dynotator/ui/utils/annotationOwnsHighlight";
import {
  applyCollectionMutation,
  isHumanHistoryMutation,
  syncHistoryHighlight,
  type CollectionMutation,
  type HistoryDirection,
} from "@dynotator/ui/utils/undoHistory";
import {
  useCheckboxOverrides,
  type CheckboxOverrideSnapshot,
  type CheckboxToggleMutation,
} from "./useCheckboxOverrides";
import { useQuestionAnswers } from "./useQuestionAnswers";

type HistoryAction =
  | {
      kind: "annotation";
      mutation: CollectionMutation<Annotation>;
      beforeSelection: string | null;
      afterSelection: string | null;
    }
  | {
      kind: "checkbox";
      mutation: CheckboxToggleMutation;
      beforeSelection: string | null;
      afterSelection: string | null;
    };

const itemId = (item: { id: string }): string => item.id;
const CHECKBOX_PREFIX = "ann-checkbox-";

/**
 * The review's annotations, global attachments and selection, with undo/redo.
 * Annotations live in a ref as well as in state so handlers fired in the same
 * tick (Viewer callbacks, history replay) see each other's writes.
 */
export function useAnnotations({
  blocks,
  viewerRef,
  readOnly,
}: {
  blocks: Block[];
  viewerRef: RefObject<ViewerHandle | null>;
  readOnly: boolean;
}) {
  const [annotations, setAnnotationsState] = useState<Annotation[]>([]);
  const annotationsRef = useRef<Annotation[]>(annotations);
  const [globalAttachments, setGlobalAttachments] = useState<ImageAttachment[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const selectionRef = useRef<string | null>(null);
  const restoreCheckboxOverridesRef = useRef<(snapshot: CheckboxOverrideSnapshot) => void>(
    () => {},
  );
  const checkboxSelectionBeforeRef = useRef<string | null | undefined>(undefined);

  const commit = useCallback((next: Annotation[]) => {
    annotationsRef.current = next;
    setAnnotationsState(next);
  }, []);
  const setAnnotations = useCallback(
    (update: Annotation[] | ((prev: Annotation[]) => Annotation[])) => {
      commit(typeof update === "function" ? update(annotationsRef.current) : update);
    },
    [commit],
  );
  const setSelected = useCallback((id: string | null) => {
    selectionRef.current = id;
    setSelectedIdState(id);
  }, []);

  const applyHistory = useCallback(
    (action: HistoryAction, direction: HistoryDirection) => {
      const selection = direction === "undo" ? action.beforeSelection : action.afterSelection;
      if (action.kind === "checkbox") {
        const { mutation } = action;
        restoreCheckboxOverridesRef.current(
          direction === "undo" ? mutation.beforeOverrides : mutation.afterOverrides,
        );
        const entries = direction === "undo" ? mutation.beforeAnnotations : mutation.afterAnnotations;
        const without = annotationsRef.current.filter(
          (a) => a.blockId !== mutation.blockId || !a.id.startsWith(CHECKBOX_PREFIX),
        );
        commit(
          entries.reduce(
            (items, entry) =>
              applyCollectionMutation(
                items,
                { kind: "add", item: entry.annotation, index: entry.index },
                "redo",
                itemId,
              ),
            without,
          ),
        );
      } else {
        const { mutation } = action;
        commit(applyCollectionMutation(annotationsRef.current, mutation, direction, itemId));
        const annotation =
          mutation.kind === "edit"
            ? direction === "undo"
              ? mutation.before
              : mutation.after
            : mutation.item;
        if (annotationOwnsHighlight(annotation)) {
          const paint =
            (mutation.kind === "add" && direction === "redo") ||
            (mutation.kind === "delete" && direction === "undo") ||
            mutation.kind === "edit";
          syncHistoryHighlight(viewerRef.current, annotation, paint);
        }
      }
      setSelected(selection);
    },
    [commit, setSelected, viewerRef],
  );
  const history = useUndoHistory<HistoryAction>({ context: "document", apply: applyHistory });

  const record = useCallback(
    (mutation: CollectionMutation<Annotation>, beforeSelection: string | null) => {
      history.record({
        kind: "annotation",
        mutation,
        beforeSelection,
        afterSelection: selectionRef.current,
      });
    },
    [history],
  );

  const add = useCallback(
    (annotation: Annotation) => {
      if (readOnly) return;
      const before = selectionRef.current;
      const index = annotationsRef.current.length;
      commit([...annotationsRef.current, annotation]);
      setSelected(annotation.id);
      if (isHumanHistoryMutation(annotation)) record({ kind: "add", item: annotation, index }, before);
    },
    [commit, readOnly, record, setSelected],
  );

  const removeQuietly = useCallback(
    (id: string) => {
      viewerRef.current?.removeHighlight(id);
      commit(annotationsRef.current.filter((a) => a.id !== id));
      if (selectionRef.current === id) setSelected(null);
    },
    [commit, setSelected, viewerRef],
  );

  const checkbox = useCheckboxOverrides({
    blocks,
    annotations,
    addAnnotation: (annotation) => {
      if (checkboxSelectionBeforeRef.current === undefined) {
        checkboxSelectionBeforeRef.current = selectionRef.current;
      }
      const index = annotationsRef.current.length;
      commit([...annotationsRef.current, annotation]);
      setSelected(annotation.id);
      return index;
    },
    removeAnnotation: (id) => {
      if (checkboxSelectionBeforeRef.current === undefined) {
        checkboxSelectionBeforeRef.current = selectionRef.current;
      }
      removeQuietly(id);
    },
    onToggleMutation: (mutation) => {
      const before = checkboxSelectionBeforeRef.current;
      history.record({
        kind: "checkbox",
        mutation,
        beforeSelection: before === undefined ? selectionRef.current : before,
        afterSelection: selectionRef.current,
      });
      checkboxSelectionBeforeRef.current = undefined;
    },
  });
  restoreCheckboxOverridesRef.current = checkbox.restoreOverrides;

  const remove = useCallback(
    (id: string) => {
      if (readOnly) return;
      const index = annotationsRef.current.findIndex((a) => a.id === id);
      const annotation = annotationsRef.current[index];
      const before = selectionRef.current;
      if (!annotation) return;
      if (id.startsWith(CHECKBOX_PREFIX)) {
        const beforeOverrides = [...checkbox.overrides.entries()] as CheckboxOverrideSnapshot;
        checkbox.revertOverride(annotation.blockId);
        removeQuietly(id);
        history.record({
          kind: "checkbox",
          mutation: {
            blockId: annotation.blockId,
            beforeOverrides,
            afterOverrides: beforeOverrides.filter(([blockId]) => blockId !== annotation.blockId),
            beforeAnnotations: [{ annotation, index }],
            afterAnnotations: [],
          },
          beforeSelection: before,
          afterSelection: selectionRef.current,
        });
        return;
      }
      removeQuietly(id);
      if (isHumanHistoryMutation(annotation)) {
        record({ kind: "delete", item: annotation, index }, before);
      }
    },
    [checkbox, history, readOnly, record, removeQuietly],
  );

  const edit = useCallback(
    (id: string, updates: Partial<Annotation>) => {
      if (readOnly) return;
      const before = annotationsRef.current.find((a) => a.id === id);
      if (!before) return;
      const after = { ...before, ...updates };
      commit(annotationsRef.current.map((a) => (a.id === id ? after : a)));
      if (isHumanHistoryMutation(before)) {
        record({ kind: "edit", before, after }, selectionRef.current);
      }
    },
    [commit, readOnly, record],
  );

  const answerQuestion = useQuestionAnswers<HistoryAction>({
    setAnnotations: setAnnotations as Parameters<typeof useQuestionAnswers>[0]["setAnnotations"],
    annotationsRef,
    history,
    toAction: (mutation) => ({
      kind: "annotation",
      mutation,
      beforeSelection: selectionRef.current,
      afterSelection: selectionRef.current,
    }),
    readOnly,
  });

  const renameAuthor = useCallback(
    (oldName: string, newName: string) => {
      history.clear();
      commit(
        annotationsRef.current.map((a) => (a.author === oldName ? { ...a, author: newName } : a)),
      );
    },
    [commit, history],
  );

  useEffect(() => {
    if (readOnly) history.clear();
  }, [history, readOnly]);

  return {
    annotations,
    annotationsRef,
    setAnnotations,
    globalAttachments,
    setGlobalAttachments,
    selectedId,
    select: setSelected,
    add,
    edit,
    remove,
    checkbox,
    answerQuestion,
    history,
    renameAuthor,
  };
}

import React, { createContext, useContext, useState } from "react";

interface EditModeContextValue {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  selectedCount: number;
  setSelectedCount: (n: number) => void;
  onDelete: (() => void) | null;
  setOnDelete: (fn: (() => void) | null) => void;
}

const EditModeContext = createContext<EditModeContextValue>({
  editMode: false,
  setEditMode: () => {},
  selectedCount: 0,
  setSelectedCount: () => {},
  onDelete: null,
  setOnDelete: () => {},
});

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editMode, setEditMode] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [onDelete, setOnDelete] = useState<(() => void) | null>(null);

  return (
    <EditModeContext.Provider
      value={{
        editMode,
        setEditMode,
        selectedCount,
        setSelectedCount,
        onDelete,
        setOnDelete,
      }}
    >
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  return useContext(EditModeContext);
}

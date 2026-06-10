import { useState, useEffect, useRef } from 'react';
import { Plus, Check, PackageOpen, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockItem } from './types';

export default function App() {
  const [items, setItems] = useState<StockItem[]>(() => {
    const saved = localStorage.getItem('restock_items');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  
  const [descriptionValue, setDescriptionValue] = useState('');
  const [quantityValue, setQuantityValue] = useState('');
  const [removedItem, setRemovedItem] = useState<{ item: StockItem; index: number; timeoutId?: NodeJS.Timeout } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Save to local storage whenever items change
  useEffect(() => {
    localStorage.setItem('restock_items', JSON.stringify(items));
  }, [items]);

  const handleAddItem = () => {
    const trimmedDesc = descriptionValue.trim();
    if (!trimmedDesc) return;

    const newItem: StockItem = {
      id: crypto.randomUUID(),
      text: `${trimmedDesc}${quantityValue ? ` x ${quantityValue}` : ''}`,
      name: trimmedDesc,
      quantity: quantityValue.trim() || undefined,
      createdAt: Date.now(),
    };

    setItems((prev) => [newItem, ...prev]);
    setDescriptionValue('');
    setQuantityValue('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleAddItem();
    }
  };

  const handleCompleteItem = (id: string) => {
    const itemIndex = items.findIndex((i) => i.id === id);
    if (itemIndex > -1) {
      if (removedItem?.timeoutId) {
        clearTimeout(removedItem.timeoutId);
      }
      
      const itemToUndo = items[itemIndex];
      const timeoutId = setTimeout(() => {
        setRemovedItem((current) => current?.item.id === itemToUndo.id ? null : current);
      }, 4000);

      setRemovedItem({ item: itemToUndo, index: itemIndex, timeoutId });
      setItems((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const undoRemove = () => {
    if (removedItem) {
      if (removedItem.timeoutId) clearTimeout(removedItem.timeoutId);
      setItems((prev) => {
        const newItems = [...prev];
        newItems.splice(removedItem.index, 0, removedItem.item);
        return newItems;
      });
      setRemovedItem(null);
    }
  };

  const updateItem = (id: string, updates: Partial<StockItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans sm:p-6 md:p-8 relative">
      <div className="mx-auto max-w-md bg-white sm:rounded-3xl sm:shadow-xl sm:border border-neutral-200 overflow-hidden min-h-screen sm:min-h-[85vh] flex flex-col relative">
        
        {/* Header */}
        <header className="bg-blue-600 text-white p-6 shadow-md z-10 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <PackageOpen size={28} />
              <h1 className="text-2xl font-bold tracking-tight">Reposición</h1>
            </div>
            <p className="text-blue-100 text-sm">Anota artículos y cantidades</p>
          </div>
        </header>

        {/* Input Area */}
        <div className="p-4 bg-white border-b border-neutral-100 shadow-sm z-10 sticky top-0 relative">
          <div className="flex gap-2 relative">
            <input
              ref={inputRef}
              type="text"
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ej: Leche descremada"
              className="flex-1 bg-neutral-100 border-none rounded-2xl px-5 py-4 text-lg focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none placeholder:text-neutral-400 min-w-0 w-full"
              autoFocus
            />
            <div className="bg-neutral-100 rounded-2xl flex items-center px-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all shrink-0 w-18">
              <input
                type="number"
                value={quantityValue}
                onChange={(e) => setQuantityValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="12"
                className="bg-transparent border-none outline-none w-full text-center text-xl font-bold p-2 placeholder:text-neutral-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                min="1"
              />
            </div>
            <button
              onClick={handleAddItem}
              disabled={!descriptionValue.trim()}
              className="bg-blue-600 text-white rounded-2xl px-5 py-4 hover:bg-blue-700 active:scale-95 disabled:bg-neutral-300 disabled:active:scale-100 transition-all flex items-center justify-center shadow-md disabled:shadow-none shrink-0"
              aria-label="Añadir artículo"
            >
              <Plus size={28} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* List Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-neutral-50/50 relative pb-24">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-400 pt-12 pb-8">
              <PackageOpen size={64} className="mb-4 text-neutral-300" strokeWidth={1.5} />
              <p className="text-lg font-medium text-neutral-500">Todo listo por ahora</p>
              <p className="text-sm mt-1 text-center max-w-[250px]">Añade artículos arriba para empezar tu lista de reposición.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3 pb-8">
              <AnimatePresence mode="popLayout">
                {items.map((item) => (
                  <motion.li
                    layout
                    initial={{ opacity: 0, y: -20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, x: 20 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    key={item.id}
                    className="bg-white border border-neutral-200 rounded-2xl p-3 pl-5 shadow-sm flex justify-between items-center gap-3"
                  >
                    <input
                      type="text"
                      value={item.name || item.text}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      className="text-lg font-medium text-neutral-800 bg-transparent border-b-2 border-transparent focus:border-blue-300 outline-none flex-1 min-w-0 transition-colors py-1"
                      aria-label="Nombre del artículo"
                    />
                    <div className="bg-blue-50 text-blue-700 font-bold rounded-xl text-sm border border-blue-100 flex items-center px-2 py-1.5 shrink-0 focus-within:ring-2 focus-within:border-blue-300 ring-blue-200 transition-all">
                      <span className="text-blue-400 select-none mr-0.5 ml-1">x</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={item.quantity || ''}
                        onChange={(e) => updateItem(item.id, { quantity: e.target.value.replace(/\D/g, '') })}
                        placeholder="1"
                        className="bg-transparent border-none outline-none w-8 text-center text-blue-700 placeholder:text-blue-300 font-bold p-0"
                        aria-label="Cantidad"
                      />
                    </div>
                    <button
                      onClick={() => handleCompleteItem(item.id)}
                      className="shrink-0 bg-green-100 text-green-700 p-3 rounded-xl hover:bg-green-200 active:bg-green-300 active:scale-90 transition-all ml-1"
                      aria-label="Marcar como repuesto y eliminar"
                    >
                      <Check size={28} strokeWidth={3} />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {/* Undo Toast */}
        <AnimatePresence>
          {removedItem && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className="absolute bottom-6 left-4 right-4 bg-gray-900 text-white p-4 rounded-2xl shadow-xl flex items-center justify-between z-50"
            >
              <div className="flex-1 truncate mr-4">
                <span className="text-sm text-gray-300 block mb-0.5">Artículo repuesto</span>
                <span className="font-medium truncate block">{removedItem.item.name || removedItem.item.text}</span>
              </div>
              <button
                onClick={undoRemove}
                className="flex items-center gap-2 text-blue-300 hover:text-blue-200 transition-colors bg-white/10 px-4 py-2 rounded-xl active:bg-white/20"
              >
                <RotateCcw size={18} />
                <span className="font-medium">Deshacer</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

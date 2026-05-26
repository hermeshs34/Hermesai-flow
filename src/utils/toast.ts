import { toast } from 'sonner';
import type { ExternalToast } from 'sonner';

export type ToastType = 'success' | 'error' | 'loading' | 'info';

interface ToastOptions extends ExternalToast {
  duration?: number;
}

/**
 * Notificación de éxito
 */
export function showSuccess(message: string, options?: ToastOptions) {
  return toast.success(message, {
    duration: 3000,
    ...options,
  });
}

/**
 * Notificación de error
 */
export function showError(message: string, options?: ToastOptions) {
  return toast.error(message, {
    duration: 4000,
    ...options,
  });
}

/**
 * Notificación de carga
 */
export function showLoading(message: string, options?: ToastOptions) {
  return toast.loading(message, {
    ...options,
  });
}

/**
 * Notificación informativa
 */
export function showInfo(message: string, options?: ToastOptions) {
  return toast(message, {
    duration: 3000,
    ...options,
  });
}

/**
 * Actualizar un toast existente
 */
export function updateToast(id: string | number, message: string) {
  toast(message, {
    id,
  });
}

/**
 * Dismissar un toast
 */
export function dismissToast(id: string | number) {
  toast.dismiss(id);
}

/**
 * Dismissar todos los toasts
 */
export function dismissAllToasts() {
  toast.dismiss();
}

/**
 * Utilidad para manejar operaciones con toast
 */
export async function executeWithToast<T>(
  promise: Promise<T>,
  messages: {
    loading?: string;
    success?: string;
    error?: string;
  }
): Promise<T> {
  const loadingId = messages.loading ? showLoading(messages.loading) : undefined;

  try {
    const result = await promise;
    if (loadingId) dismissToast(loadingId);
    if (messages.success) showSuccess(messages.success);
    return result;
  } catch (error) {
    if (loadingId) dismissToast(loadingId);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    if (messages.error) {
      showError(`${messages.error}: ${errorMessage}`);
    } else {
      showError(errorMessage);
    }
    throw error;
  }
}

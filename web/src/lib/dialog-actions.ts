export type Tone = 'default' | 'danger';

export interface DialogOptions {
  title?: string;
  tone?: Tone;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface DialogRequest extends DialogOptions {
  kind: 'confirm' | 'alert';
  message: string;
  resolve: (value: boolean) => void;
}

let dispatch: ((req: DialogRequest) => void) | null = null;

export function setDialogDispatcher(fn: ((req: DialogRequest) => void) | null) {
  dispatch = fn;
}

function request(kind: DialogRequest['kind'], message: string, opts: DialogOptions): Promise<boolean> {
  return new Promise(resolve => {
    const req: DialogRequest = { kind, message, resolve, ...opts };
    if (dispatch) dispatch(req);
    else resolve(kind === 'alert' ? true : window.confirm(message));
  });
}

export function confirmDialog(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return request('confirm', message, opts);
}

export function alertDialog(message: string, opts: DialogOptions = {}): Promise<void> {
  return request('alert', message, opts).then(() => undefined);
}

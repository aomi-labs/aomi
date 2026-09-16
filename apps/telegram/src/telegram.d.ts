export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { start_param?: string };
        ready(): void;
        expand(): void;
        close(): void;
        sendData(data: string): void;
        HapticFeedback?: {
          notificationOccurred(type: "error" | "success" | "warning"): void;
        };
      };
    };
  }
}

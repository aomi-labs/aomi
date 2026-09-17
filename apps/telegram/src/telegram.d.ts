export {};

/** The subset of Telegram's WebApp API this Mini App actually calls.
 *
 *  Everything here is optional on the object because the SDK is loaded from
 *  telegram.org at whatever version the client ships: a member existing in this
 *  type is not a promise that it exists at runtime. Call sites guard with
 *  `supportsVersion` rather than assuming. `initDataUnsafe` is deliberately NOT
 *  declared — this app only ever trusts the server-verified launch. */
declare global {
  interface TelegramThemeParams {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
    section_bg_color?: string;
    section_separator_color?: string;
    subtitle_text_color?: string;
    destructive_text_color?: string;
    accent_text_color?: string;
  }

  interface TelegramBackButton {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  }

  interface TelegramMainButton {
    setText(text: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  }

  interface TelegramWebApp {
    initData: string;
    version?: string;
    platform?: string;
    colorScheme?: "light" | "dark";
    themeParams?: TelegramThemeParams;
    isExpanded?: boolean;
    ready(): void;
    expand(): void;
    close(): void;
    isVersionAtLeast?(version: string): boolean;
    onEvent?(event: string, handler: () => void): void;
    offEvent?(event: string, handler: () => void): void;
    disableVerticalSwipes?(): void;
    enableClosingConfirmation?(): void;
    disableClosingConfirmation?(): void;
    BackButton?: TelegramBackButton;
    MainButton?: TelegramMainButton;
    HapticFeedback?: {
      notificationOccurred(type: "error" | "success" | "warning"): void;
      impactOccurred(style: "light" | "medium" | "heavy"): void;
      selectionChanged(): void;
    };
  }

  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

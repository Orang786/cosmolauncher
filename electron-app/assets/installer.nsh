; ═══════════════════════════════════════════════
; CosmoLauncher — Кастомный NSIS скрипт
; ═══════════════════════════════════════════════

!macro customHeader
  !system "echo Собираем CosmoLauncher установщик..."
!macroend

; Страница приветствия
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Добро пожаловать в установщик CosmoLauncher"
  !define MUI_WELCOMEPAGE_TEXT "Этот мастер установит CosmoLauncher на ваш компьютер.$\r$\n$\r$\nCosmoLauncher — бесплатный лаунчер Minecraft с поддержкой всех версий игры.$\r$\n$\r$\nНажмите Далее для продолжения."
!macroend

; После установки
!macro customInstall
  ; Создать папку данных
  CreateDirectory "$APPDATA\CosmoLauncher"
  CreateDirectory "$APPDATA\CosmoLauncher\versions"
  CreateDirectory "$APPDATA\CosmoLauncher\assets"
  CreateDirectory "$APPDATA\CosmoLauncher\libraries"

  ; Записать версию
  FileOpen $0 "$APPDATA\CosmoLauncher\version.txt" w
  FileWrite $0 "1.0.0"
  FileClose $0

  ; Добавить в реестр для Programs and Features
  WriteRegStr HKCU "Software\CosmoLauncher" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\CosmoLauncher" "Version" "1.0.0"
!macroend

; При удалении
!macro customUnInstall
  ; Спросить удалять ли данные игры
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Удалить данные игры (версии Minecraft, ресурсы)?$\r$\nЕсли нажмёте Нет — данные сохранятся." \
    IDYES DeleteData IDNO SkipData

  DeleteData:
    RMDir /r "$APPDATA\CosmoLauncher"
    Goto Done

  SkipData:
    ; Ничего не делаем

  Done:
  ; Удалить записи реестра
  DeleteRegKey HKCU "Software\CosmoLauncher"
!macroend
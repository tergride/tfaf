; Extends the maintained NSIS installer. The portable branch returns before the
; standard section uninstalls an old version or writes shortcuts/registry entries.
!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var tfafPortable
Var tfafPortableDirectory
Var tfafModeDialog
Var tfafNormalRadio
Var tfafPortableRadio
Var tfafValidationError

LangString tfafModeTitle 1033 "Installation type"
LangString tfafModeTitle 1049 "Тип установки"
LangString tfafModeDescription 1033 "Choose how TFAF should store its files and settings."
LangString tfafModeDescription 1049 "Выберите, как TFAF будет хранить свои файлы и настройки."
LangString tfafNormal 1033 "Standard installation"
LangString tfafNormal 1049 "Обычная установка"
LangString tfafNormalHint 1033 "Choose the installation folder and install for the current user or all users. Updates are automatic in release builds."
LangString tfafNormalHint 1049 "Выбор папки и установка для текущего пользователя или для всех пользователей. В релизных сборках обновления устанавливаются автоматически."
LangString tfafPortable 1033 "Portable"
LangString tfafPortable 1049 "Portable"
LangString tfafPortableHint 1033 "Keep TFAF data beside the application. No Windows registration or shortcuts. Update manually by selecting this folder again."
LangString tfafPortableHint 1049 "Данные TFAF рядом с программой. Без регистрации в Windows и ярлыков. Обновление вручную: выберите эту папку в новом установщике."
LangString tfafReadyTitle 1033 "Confirm installation folder"
LangString tfafReadyTitle 1049 "Подтверждение папки установки"
LangString tfafReadyDescription 1033 "Check the destination before installing. Use Back to change it."
LangString tfafReadyDescription 1049 "Проверьте папку перед установкой. Чтобы изменить её, нажмите «Назад»."
LangString tfafPortableConflict 1033 "This folder contains a portable copy. Select Portable or choose another folder."
LangString tfafPortableConflict 1049 "В этой папке находится portable-копия. Выберите Portable или другую папку."
LangString tfafNormalConflict 1033 "This folder is an installed copy of TFAF or lies inside one: updating or uninstalling that copy would delete a portable copy here. Choose another folder."
LangString tfafNormalConflict 1049 "Эта папка — установленная копия TFAF или находится внутри неё: обновление или удаление этой копии стёрло бы portable-копию. Выберите другую папку."
LangString tfafNotEmpty 1033 "Select an empty folder or an existing TFAF portable folder."
LangString tfafNotEmpty 1049 "Выберите пустую папку или существующую portable-папку TFAF."
LangString tfafAsciiPath 1033 "Portable requires a path with Latin letters (ASCII): the game cannot load its files from other paths."
LangString tfafAsciiPath 1049 "Для Portable нужен путь с латинскими символами (ASCII): игра не загружает свои файлы из других путей."
LangString tfafWriteError 1033 "Cannot write to the selected folder. Check access permissions and close TFAF before updating a portable copy."
LangString tfafWriteError 1049 "Не удалось записать файлы в выбранную папку. Проверьте права доступа и закройте TFAF перед обновлением portable-копии."
LangString tfafExtractError 1033 "Could not unpack all application files. Download the installer again and retry. Your portable data has been kept."
LangString tfafExtractError 1049 "Не удалось распаковать файлы программы. Скачайте установщик заново и повторите установку. Данные portable-копии сохранены."
!endif

!macro customWelcomePage
  !include "${BUILD_RESOURCES_DIR}\installer-pages.nsh"
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${if} $tfafPortable == "1"
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  !endif
!macroend

!macro customPageAfterChangeDir
  Page custom TfafConfirmCreate TfafConfirmLeave
  ; The stock instFilesPre appends the product name. Portable copies can be
  ; renamed or moved and must update the exact folder selected by their owner.
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE TfafInstFilesPre
!macroend

!macro customInit
  StrCpy $tfafPortable "0"
  StrCpy $tfafPortableDirectory "$EXEDIR\TFAF"
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/PORTABLE" $1
  ${ifNot} ${Errors}
    StrCpy $tfafPortable "1"
    ; A portable install must not inherit an existing per-machine installation.
    StrCpy $hasPerMachineInstallation "0"
    StrCpy $hasPerUserInstallation "0"
    StrCpy $installMode "CurrentUser"
    SetShellVarContext current
    !insertmacro GetDParameter $1
    ${if} $1 != ""
      StrCpy $tfafPortableDirectory $1
    ${endif}
    StrCpy $INSTDIR $tfafPortableDirectory
  ${endif}
  ; The stock running-process hook is skipped in an elevated inner installer.
  ; Silent runs also skip page callbacks, so normalize and validate their final path here.
  ${if} ${Silent}
    ; The window appends \TFAF to a folder without it before installing (instFilesPre). A silent /D= gets the same,
    ; or an uninstall would delete the whole folder given, such as C:\Games. Updates keep the installed folder.
    ${if} $tfafPortable != "1"
    ${andIfNot} ${isUpdated}
      !insertmacro GetDParameter $1
      ${if} $1 != ""
        Call instFilesPre
      ${endif}
    ${endif}
    Call TfafValidateTarget
    ${if} $tfafValidationError != ""
      MessageBox MB_OK|MB_ICONSTOP "$tfafValidationError" /SD IDOK
      SetErrorLevel 2
      Quit
    ${endif}
  ${endif}
!macroend

!macro customHeader
  ; The stock include omits these when customCheckAppRunning is supplied.
  !include getProcessInfo.nsh
  Var pid
  !ifndef BUILD_UNINSTALLER
    !include "${BUILD_RESOURCES_DIR}\installer-functions.nsh"
  !endif
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    Call TfafValidateTarget
    ${if} $tfafValidationError != ""
      MessageBox MB_OK|MB_ICONSTOP "$tfafValidationError" /SD IDOK
      SetErrorLevel 2
      Quit
    ${endif}
    ${if} $tfafPortable == "1"
      ; Only x64 is distributed. Embed the same archive as the normal section;
      ; NSIS deduplicates its data, so this does not double the installer size.
      InitPluginsDir
      SetOutPath "$PLUGINSDIR\tfaf-portable"
      !ifdef COMPRESS
        SetCompress off
      !endif
      File /oname=$PLUGINSDIR\tfaf-app.7z "${APP_64}"
      !ifdef COMPRESS
        SetCompress "${COMPRESS}"
      !endif
      ClearErrors
      Nsis7z::Extract "$PLUGINSDIR\tfaf-app.7z"
      ${if} ${Errors}
        Goto tfafExtractFailed
      ${endif}
      ${ifNot} ${FileExists} "$PLUGINSDIR\tfaf-portable\${APP_EXECUTABLE_FILENAME}"
      ${orIfNot} ${FileExists} "$PLUGINSDIR\tfaf-portable\resources\app.asar"
        Goto tfafExtractFailed
      ${endif}
      CreateDirectory "$INSTDIR"
      ; Write the marker before the executable: an interrupted first install
      ; must never start with the user's ordinary profile.
      ClearErrors
      FileOpen $0 "$INSTDIR\portable.flag" w
      ${if} ${Errors}
        Goto tfafWriteFailed
      ${endif}
      FileClose $0
      ClearErrors
      CopyFiles /SILENT "$PLUGINSDIR\tfaf-portable\*.*" "$INSTDIR"
      ${if} ${Errors}
        Goto tfafWriteFailed
      ${endif}
      SetOutPath "$INSTDIR"
      StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ; Silent portable installs never launch an app or register an uninstaller.
      Return
      tfafExtractFailed:
        MessageBox MB_OK|MB_ICONSTOP "$(tfafExtractError)" /SD IDOK
        SetErrorLevel 2
        Quit
      tfafWriteFailed:
        MessageBox MB_OK|MB_ICONSTOP "$(tfafWriteError)" /SD IDOK
        SetErrorLevel 2
        Quit
    ${endif}
  !endif
  ; Retain electron-builder's normal update/install/uninstall process handling.
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

Function TfafConfirmCreate
  ${if} ${isUpdated}
    Abort
  ${endif}
  ; Keep the stock normalization for normal installs, but never nest a new copy
  ; inside a portable folder the user renamed or moved.
  ${if} $tfafPortable != "1"
    Call instFilesPre
  ${endif}
  ${if} $tfafPortable == "1"
    StrCpy $tfafPortableDirectory $INSTDIR
  ${endif}
  !insertmacro MUI_HEADER_TEXT "$(tfafReadyTitle)" "$(tfafReadyDescription)"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 8u 100% 36u "$INSTDIR"
  Pop $0
  ${if} $tfafPortable == "1"
    ${NSD_CreateLabel} 0 50u 100% 50u "$(tfafPortableHint)"
    Pop $0
  ${endif}
  nsDialogs::Show
FunctionEnd

Function TfafInstFilesPre
  ${if} $tfafPortable != "1"
    Call instFilesPre
  ${endif}
  ; Covers both the ordinary process and the elevated all-users inner process.
  Call TfafValidateTarget
  ${if} $tfafValidationError != ""
    MessageBox MB_OK|MB_ICONSTOP "$tfafValidationError" /SD IDOK
    SetErrorLevel 2
    Quit
  ${endif}
FunctionEnd

Function TfafConfirmLeave
  Call TfafValidateTarget
  ${if} $tfafValidationError != ""
    MessageBox MB_OK|MB_ICONSTOP "$tfafValidationError"
    Abort
  ${endif}
FunctionEnd

; Normalizes the path on the stack without requiring it to exist (NSIS
; GetFullPathName returns an empty string for a folder that is not created yet).
Function TfafFullPath
  Exch $0
  Push $1
  Push $2
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r2'
  ${if} $2 = 0
  ${orIf} $2 >= ${NSIS_MAX_STRLEN}
    StrCpy $1 ""
  ${endif}
  StrCpy $2 $1 1 -1
  ${if} $2 == "\"
    StrLen $2 $1
    ${if} $2 > 3
      StrCpy $1 $1 -1
    ${endif}
  ${endif}
  StrCpy $0 $1
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; Refuses the normalized target in $2 when it is, or lies inside, the folder of
; a normal installation registered under ROOT. String comparison ignores case.
!macro TfafRefuseInsideInstallation ROOT
  ReadRegStr $0 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 != ""
    Push $0
    Call TfafFullPath
    Pop $0
    StrLen $1 $0
    StrCpy $3 $2 $1
    StrCpy $4 $2 1 $1
    ${if} $0 != ""
    ${andIf} $3 == $0
      ${if} $4 == ""
      ${orIf} $4 == "\"
        StrCpy $tfafValidationError "$(tfafNormalConflict)"
        Return
      ${endif}
    ${endif}
  ${endif}
!macroend

; Validation also runs for silent installs, before any standard uninstall/write.
; It runs inside the stock install section too, so it leaves the registers as they were.
Function TfafValidateTarget
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Call TfafValidateTargetChecks
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function TfafValidateTargetChecks
  StrCpy $tfafValidationError ""
  ${if} $tfafPortable != "1"
    ${if} ${FileExists} "$INSTDIR\portable.flag"
      StrCpy $tfafValidationError "$(tfafPortableConflict)"
    ${endif}
    Return
  ${endif}

  ; A portable destination must be ASCII because it also holds game files.
  StrLen $0 $INSTDIR
  IntOp $0 $0 + 1
  System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w "$INSTDIR", i -1, p 0, i 0, p 0, p 0) i.r1'
  ${if} $0 != $1
    StrCpy $tfafValidationError "$(tfafAsciiPath)"
    Return
  ${endif}

  ; Check both installation scopes even if someone placed a marker in a normal
  ; installation. A portable install never converts or uninstalls that copy, and
  ; never goes inside it: its updates and uninstall delete the whole folder.
  Push $INSTDIR
  Call TfafFullPath
  Pop $2
  !insertmacro TfafRefuseInsideInstallation HKCU
  !insertmacro TfafRefuseInsideInstallation HKLM
  ${ifNot} ${FileExists} "$INSTDIR\portable.flag"
    FindFirst $0 $1 "$INSTDIR\*"
    tfafFindNext:
      ${if} $1 == ""
        Goto tfafFindDone
      ${endif}
      ${if} $1 != "."
      ${andIf} $1 != ".."
        FindClose $0
        StrCpy $tfafValidationError "$(tfafNotEmpty)"
        Return
      ${endif}
      FindNext $0 $1
      Goto tfafFindNext
    tfafFindDone:
      FindClose $0
  ${endif}

  ; Opening for write without truncation detects a running target executable.
  ; Do not terminate another portable or installed instance by its image name.
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r0'
    ${if} $0 == -1
      StrCpy $tfafValidationError "$(tfafWriteError)"
      Return
    ${endif}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${endif}
FunctionEnd

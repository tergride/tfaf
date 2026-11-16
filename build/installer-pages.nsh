; This is included after electron-builder's common macros, before its scope and
; directory pages. Preserve update skipping while choosing the portable default.
!macroundef skipPageIfUpdated
!macro skipPageIfUpdated
  !define UniqueID ${__LINE__}
  Function tfafPagePre_${UniqueID}
    ${if} ${isUpdated}
      Abort
    ${endif}
    ${if} $tfafPortable == "1"
      StrCpy $INSTDIR $tfafPortableDirectory
    ${endif}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE tfafPagePre_${UniqueID}
  !undef UniqueID
!macroend

Page custom TfafModeCreate TfafModeLeave

Function TfafModeCreate
  ${if} ${isUpdated}
  ${orIf} ${UAC_IsInnerInstance}
    Abort
  ${endif}
  !insertmacro MUI_HEADER_TEXT "$(tfafModeTitle)" "$(tfafModeDescription)"
  nsDialogs::Create 1018
  Pop $tfafModeDialog
  ${NSD_CreateRadioButton} 0 5u 100% 12u "$(tfafNormal)"
  Pop $tfafNormalRadio
  ${NSD_CreateLabel} 12u 22u 95% 36u "$(tfafNormalHint)"
  Pop $0
  ${NSD_CreateRadioButton} 0 70u 100% 12u "$(tfafPortable)"
  Pop $tfafPortableRadio
  ${NSD_CreateLabel} 12u 87u 95% 45u "$(tfafPortableHint)"
  Pop $0
  ${if} $tfafPortable == "1"
    ${NSD_Check} $tfafPortableRadio
  ${else}
    ${NSD_Check} $tfafNormalRadio
  ${endif}
  nsDialogs::Show
FunctionEnd

Function TfafModeLeave
  ${NSD_GetState} $tfafPortableRadio $tfafPortable
FunctionEnd

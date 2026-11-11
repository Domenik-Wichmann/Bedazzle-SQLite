import ctypes,unittest
from unittest.mock import Mock,patch
from types import SimpleNamespace
from file_dialog import choose

class PickerOwnerTests(unittest.TestCase):
 def check_owner(self,title):
  handle=0x123456781234;captured=[]
  def window_text(hwnd,buffer,length):buffer.value=title;return len(title)
  def dialog(pointer):captured.append(pointer._obj.hwndOwner);return 0
  windows=SimpleNamespace(user32=SimpleNamespace(GetForegroundWindow=Mock(return_value=handle),GetWindowTextW=Mock(side_effect=window_text)),
                          comdlg32=SimpleNamespace(GetOpenFileNameW=Mock(side_effect=dialog),CommDlgExtendedError=Mock(return_value=0)))
  with patch.object(ctypes,'windll',windows):self.assertEqual(choose('open'),{'path':None})
  return handle,captured[0]
 def test_chooser_keeps_full_64_bit_bedazzle_owner(self):
  handle,owner=self.check_owner('Bedazzle - Google Chrome');self.assertEqual(owner,handle)
 def test_unrelated_foreground_app_is_not_disabled(self):
  _,owner=self.check_owner('Untitled - Notepad');self.assertIsNone(owner)

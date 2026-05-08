#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <UIAutomation.h>
#include <shellapi.h>
#include <wrl/client.h>

#include <algorithm>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

struct Request {
  std::string operation;
  std::wstring selector;
  std::wstring text;
  std::wstring application;
  std::wstring windowTitle;
  bool includeAccessibility = false;
  int maxDepth = 4;
};

struct Selector {
  std::map<std::wstring, std::wstring> fields;
};

std::string ReadStdin() {
  std::ostringstream buffer;
  buffer << std::cin.rdbuf();
  return buffer.str();
}

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) return L"";
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) return L"";
  std::wstring out(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), out.data(), size);
  return out;
}

std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) return "";
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return "";
  std::string out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
  return out;
}

std::string JsonEscape(const std::wstring& value) {
  std::string utf8 = WideToUtf8(value);
  std::string out;
  out.reserve(utf8.size() + 8);
  for (const unsigned char ch : utf8) {
    switch (ch) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (ch < 0x20) {
          const char* hex = "0123456789abcdef";
          out += "\\u00";
          out += hex[(ch >> 4) & 0x0F];
          out += hex[ch & 0x0F];
        } else {
          out += static_cast<char>(ch);
        }
    }
  }
  return out;
}

std::wstring ToLower(std::wstring value) {
  std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
    return static_cast<wchar_t>(towlower(ch));
  });
  return value;
}

std::wstring Trim(const std::wstring& value) {
  const auto first = value.find_first_not_of(L" \t\r\n");
  if (first == std::wstring::npos) return L"";
  const auto last = value.find_last_not_of(L" \t\r\n");
  return value.substr(first, last - first + 1);
}

size_t FindFieldValueStart(const std::string& json, const std::string& field) {
  const std::string needle = "\"" + field + "\"";
  const size_t key = json.find(needle);
  if (key == std::string::npos) return std::string::npos;
  const size_t colon = json.find(':', key + needle.size());
  if (colon == std::string::npos) return std::string::npos;
  size_t pos = colon + 1;
  while (pos < json.size() && isspace(static_cast<unsigned char>(json[pos]))) pos += 1;
  return pos;
}

std::string ReadJsonStringField(const std::string& json, const std::string& field) {
  size_t pos = FindFieldValueStart(json, field);
  if (pos == std::string::npos || pos >= json.size() || json[pos] != '"') return "";
  pos += 1;
  std::string out;
  while (pos < json.size()) {
    const char ch = json[pos++];
    if (ch == '"') break;
    if (ch != '\\' || pos >= json.size()) {
      out += ch;
      continue;
    }
    const char escaped = json[pos++];
    switch (escaped) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      default: break;
    }
  }
  return out;
}

bool ReadJsonBoolField(const std::string& json, const std::string& field, bool fallback) {
  const size_t pos = FindFieldValueStart(json, field);
  if (pos == std::string::npos) return fallback;
  if (json.compare(pos, 4, "true") == 0) return true;
  if (json.compare(pos, 5, "false") == 0) return false;
  return fallback;
}

int ReadJsonIntField(const std::string& json, const std::string& field, int fallback) {
  const size_t pos = FindFieldValueStart(json, field);
  if (pos == std::string::npos) return fallback;
  try {
    return std::stoi(json.substr(pos));
  } catch (...) {
    return fallback;
  }
}

Request ParseRequest(const std::string& json) {
  Request request;
  request.operation = ReadJsonStringField(json, "operation");
  request.selector = Utf8ToWide(ReadJsonStringField(json, "selector"));
  request.text = Utf8ToWide(ReadJsonStringField(json, "text"));
  request.application = Utf8ToWide(ReadJsonStringField(json, "application"));
  request.windowTitle = Utf8ToWide(ReadJsonStringField(json, "windowTitle"));
  request.includeAccessibility = ReadJsonBoolField(json, "includeAccessibility", false);
  request.maxDepth = std::max(1, std::min(8, ReadJsonIntField(json, "maxDepth", 4)));
  return request;
}

Selector ParseSelector(const std::wstring& value) {
  Selector selector;
  size_t start = 0;
  while (start < value.size()) {
    const size_t end = value.find(L';', start);
    const std::wstring part = value.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
    const size_t equals = part.find(L'=');
    if (equals != std::wstring::npos) {
      selector.fields[ToLower(Trim(part.substr(0, equals)))] = Trim(part.substr(equals + 1));
    }
    if (end == std::wstring::npos) break;
    start = end + 1;
  }
  return selector;
}

std::wstring BstrToWide(BSTR value) {
  if (!value) return L"";
  return std::wstring(value, SysStringLen(value));
}

std::wstring ElementString(IUIAutomationElement* element, PROPERTYID property) {
  if (!element) return L"";
  BSTR value = nullptr;
  HRESULT hr = E_FAIL;
  if (property == UIA_NamePropertyId) hr = element->get_CurrentName(&value);
  if (property == UIA_AutomationIdPropertyId) hr = element->get_CurrentAutomationId(&value);
  if (property == UIA_ClassNamePropertyId) hr = element->get_CurrentClassName(&value);
  if (property == UIA_LocalizedControlTypePropertyId) hr = element->get_CurrentLocalizedControlType(&value);
  std::wstring out;
  if (SUCCEEDED(hr) && value) out = BstrToWide(value);
  if (value) SysFreeString(value);
  return out;
}

int ElementControlType(IUIAutomationElement* element) {
  CONTROLTYPEID type = 0;
  if (!element || FAILED(element->get_CurrentControlType(&type))) return 0;
  return type;
}

std::wstring ProcessName(IUIAutomationElement* element) {
  int processId = 0;
  if (!element || FAILED(element->get_CurrentProcessId(&processId)) || processId <= 0) return L"";
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(processId));
  if (!process) return L"";
  wchar_t path[MAX_PATH];
  DWORD size = MAX_PATH;
  std::wstring out;
  if (QueryFullProcessImageNameW(process, 0, path, &size)) {
    out.assign(path, size);
    const size_t slash = out.find_last_of(L"\\/");
    if (slash != std::wstring::npos) out = out.substr(slash + 1);
    const size_t dot = out.find_last_of(L'.');
    if (dot != std::wstring::npos) out = out.substr(0, dot);
  }
  CloseHandle(process);
  return out;
}

std::wstring ProcessNameFromId(DWORD processId) {
  if (processId == 0) return L"";
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) return L"";
  wchar_t path[MAX_PATH];
  DWORD size = MAX_PATH;
  std::wstring out;
  if (QueryFullProcessImageNameW(process, 0, path, &size)) {
    out.assign(path, size);
    const size_t slash = out.find_last_of(L"\\/");
    if (slash != std::wstring::npos) out = out.substr(slash + 1);
    const size_t dot = out.find_last_of(L'.');
    if (dot != std::wstring::npos) out = out.substr(0, dot);
  }
  CloseHandle(process);
  return out;
}

std::wstring WindowTitle(HWND hwnd) {
  const int length = GetWindowTextLengthW(hwnd);
  if (length <= 0) return L"";
  std::wstring title(static_cast<size_t>(length + 1), L'\0');
  GetWindowTextW(hwnd, title.data(), length + 1);
  title.resize(static_cast<size_t>(length));
  return title;
}

std::wstring WindowProcessName(HWND hwnd) {
  DWORD processId = 0;
  GetWindowThreadProcessId(hwnd, &processId);
  return ProcessNameFromId(processId);
}

struct WindowSearch {
  std::wstring application;
  std::wstring windowTitle;
  HWND hwnd = nullptr;
};

struct CapturedWindow {
  std::wstring application;
  std::wstring windowTitle;
};

bool ContainsInsensitive(const std::wstring& haystack, const std::wstring& needle) {
  if (needle.empty()) return true;
  return ToLower(haystack).find(ToLower(needle)) != std::wstring::npos;
}

bool IsCalculatorAlias(const std::wstring& value) {
  const std::wstring lower = ToLower(value);
  return lower == L"calculator"
    || lower == L"calculadora"
    || lower == L"calculatorapp"
    || lower == L"calc"
    || lower == L"applicationframehost";
}

bool ApplicationMatches(const std::wstring& process, const std::wstring& title, const std::wstring& requestedApplication) {
  if (requestedApplication.empty()) return true;
  if (IsCalculatorAlias(requestedApplication)) {
    return IsCalculatorAlias(process) || IsCalculatorAlias(title);
  }
  return ToLower(process) == ToLower(requestedApplication) || ContainsInsensitive(title, requestedApplication);
}

BOOL CALLBACK FindWindowCallback(HWND hwnd, LPARAM lparam) {
  auto* search = reinterpret_cast<WindowSearch*>(lparam);
  if (!search || !IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
  const std::wstring title = WindowTitle(hwnd);
  const std::wstring process = WindowProcessName(hwnd);
  if (title.empty() && process.empty()) return TRUE;
  const bool applicationMatches = ApplicationMatches(process, title, search->application);
  const bool titleMatches = search->windowTitle.empty() || ContainsInsensitive(title, search->windowTitle);
  if (applicationMatches && titleMatches) {
    search->hwnd = hwnd;
    return FALSE;
  }
  return TRUE;
}

HWND FindRequestedWindow(const Request& request) {
  WindowSearch search;
  search.application = request.application;
  search.windowTitle = request.windowTitle;
  EnumWindows(FindWindowCallback, reinterpret_cast<LPARAM>(&search));
  return search.hwnd;
}

std::wstring ExecutableCandidate(const std::wstring& application) {
  const std::wstring lower = ToLower(application);
  if (lower == L"calculator" || lower == L"calculadora" || lower == L"calculatorapp" || lower == L"calc") return L"calc.exe";
  if (lower == L"msedge" || lower == L"edge" || lower == L"microsoft edge") return L"msedge.exe";
  if (lower.size() >= 4 && lower.substr(lower.size() - 4) == L".exe") return application;
  return application + L".exe";
}

bool FocusWindow(HWND hwnd) {
  if (!hwnd) return false;
  ShowWindow(hwnd, SW_RESTORE);
  SetForegroundWindow(hwnd);
  return true;
}

bool OpenApplication(const Request& request) {
  if (request.application.empty()) return false;
  const std::wstring executable = ExecutableCandidate(request.application);
  HINSTANCE result = ShellExecuteW(nullptr, L"open", executable.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<INT_PTR>(result) > 32) return true;
  result = ShellExecuteW(nullptr, L"open", request.application.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  return reinterpret_cast<INT_PTR>(result) > 32;
}

CapturedWindow CaptureWindow(HWND hwnd) {
  CapturedWindow captured;
  if (!hwnd) return captured;
  captured.application = WindowProcessName(hwnd);
  captured.windowTitle = WindowTitle(hwnd);
  if (captured.application.empty()) captured.application = captured.windowTitle;
  return captured;
}

bool WaitForWindowClosed(const Request& request, HWND hwnd) {
  for (int attempt = 0; attempt < 20; attempt += 1) {
    Sleep(50);
    if (!IsWindow(hwnd)) return true;
    HWND remaining = FindRequestedWindow(request);
    if (!remaining) return true;
  }
  return false;
}

ComPtr<IUIAutomationElement> ResolveActiveWindow(IUIAutomation* automation) {
  ComPtr<IUIAutomationElement> focused;
  if (FAILED(automation->GetFocusedElement(&focused)) || !focused) return nullptr;

  if (ElementControlType(focused.Get()) == UIA_WindowControlTypeId) return focused;

  ComPtr<IUIAutomationTreeWalker> walker;
  if (FAILED(automation->get_ControlViewWalker(&walker)) || !walker) return focused;

  ComPtr<IUIAutomationElement> current = focused;
  for (int index = 0; index < 32 && current; index += 1) {
    if (ElementControlType(current.Get()) == UIA_WindowControlTypeId) return current;
    ComPtr<IUIAutomationElement> parent;
    if (FAILED(walker->GetParentElement(current.Get(), &parent)) || !parent) break;
    current = parent;
  }
  return focused;
}

CONTROLTYPEID ControlTypeFromName(const std::wstring& raw) {
  const std::wstring value = ToLower(raw);
  if (value == L"button") return UIA_ButtonControlTypeId;
  if (value == L"edit" || value == L"textfield" || value == L"textbox") return UIA_EditControlTypeId;
  if (value == L"text") return UIA_TextControlTypeId;
  if (value == L"window") return UIA_WindowControlTypeId;
  if (value == L"menuitem") return UIA_MenuItemControlTypeId;
  if (value == L"checkbox") return UIA_CheckBoxControlTypeId;
  if (value == L"radiobutton") return UIA_RadioButtonControlTypeId;
  if (value == L"combobox") return UIA_ComboBoxControlTypeId;
  if (value == L"listitem") return UIA_ListItemControlTypeId;
  if (value == L"list") return UIA_ListControlTypeId;
  if (value == L"tabitem") return UIA_TabItemControlTypeId;
  if (value == L"tab") return UIA_TabControlTypeId;
  if (value == L"hyperlink") return UIA_HyperlinkControlTypeId;
  if (value == L"pane") return UIA_PaneControlTypeId;
  return 0;
}

HRESULT AddStringCondition(IUIAutomation* automation, PROPERTYID property, const std::wstring& value, std::vector<ComPtr<IUIAutomationCondition>>& conditions) {
  VARIANT variant;
  VariantInit(&variant);
  variant.vt = VT_BSTR;
  variant.bstrVal = SysAllocString(value.c_str());
  ComPtr<IUIAutomationCondition> condition;
  const HRESULT hr = automation->CreatePropertyCondition(property, variant, &condition);
  VariantClear(&variant);
  if (SUCCEEDED(hr) && condition) conditions.push_back(condition);
  return hr;
}

HRESULT AddControlTypeCondition(IUIAutomation* automation, CONTROLTYPEID controlType, std::vector<ComPtr<IUIAutomationCondition>>& conditions) {
  VARIANT variant;
  VariantInit(&variant);
  variant.vt = VT_I4;
  variant.lVal = controlType;
  ComPtr<IUIAutomationCondition> condition;
  const HRESULT hr = automation->CreatePropertyCondition(UIA_ControlTypePropertyId, variant, &condition);
  VariantClear(&variant);
  if (SUCCEEDED(hr) && condition) conditions.push_back(condition);
  return hr;
}

ComPtr<IUIAutomationCondition> BuildCondition(IUIAutomation* automation, const Selector& selector) {
  std::vector<ComPtr<IUIAutomationCondition>> conditions;
  for (const auto& [key, value] : selector.fields) {
    if (key == L"title" || key == L"name") AddStringCondition(automation, UIA_NamePropertyId, value, conditions);
    else if (key == L"automationid" || key == L"id") AddStringCondition(automation, UIA_AutomationIdPropertyId, value, conditions);
    else if (key == L"classname") AddStringCondition(automation, UIA_ClassNamePropertyId, value, conditions);
    else if (key == L"type" || key == L"controltype") {
      const CONTROLTYPEID controlType = ControlTypeFromName(value);
      if (controlType != 0) AddControlTypeCondition(automation, controlType, conditions);
    }
  }
  if (conditions.empty()) {
    ComPtr<IUIAutomationCondition> trueCondition;
    automation->CreateTrueCondition(&trueCondition);
    return trueCondition;
  }
  ComPtr<IUIAutomationCondition> current = conditions[0];
  for (size_t index = 1; index < conditions.size(); index += 1) {
    ComPtr<IUIAutomationCondition> combined;
    if (FAILED(automation->CreateAndCondition(current.Get(), conditions[index].Get(), &combined))) return nullptr;
    current = combined;
  }
  return current;
}

ComPtr<IUIAutomationElement> FindTarget(IUIAutomation* automation, IUIAutomationElement* root, const std::wstring& selectorText) {
  const Selector selector = ParseSelector(selectorText);
  ComPtr<IUIAutomationCondition> condition = BuildCondition(automation, selector);
  if (!condition) return nullptr;
  ComPtr<IUIAutomationElement> element;
  if (FAILED(root->FindFirst(TreeScope_Subtree, condition.Get(), &element))) return nullptr;
  return element;
}

void AppendTree(IUIAutomationTreeWalker* walker, IUIAutomationElement* element, int depth, int maxDepth, std::wostringstream& out) {
  if (!element || depth > maxDepth) return;
  for (int index = 0; index < depth; index += 1) out << L"  ";
  out << ElementString(element, UIA_LocalizedControlTypePropertyId);
  const std::wstring name = ElementString(element, UIA_NamePropertyId);
  const std::wstring automationId = ElementString(element, UIA_AutomationIdPropertyId);
  const std::wstring className = ElementString(element, UIA_ClassNamePropertyId);
  if (!name.empty()) out << L" \"" << name << L"\"";
  if (!automationId.empty()) out << L" #" << automationId;
  if (!className.empty()) out << L" ." << className;
  out << L"\n";
  if (depth == maxDepth) return;

  ComPtr<IUIAutomationElement> child;
  if (FAILED(walker->GetFirstChildElement(element, &child))) return;
  while (child) {
    AppendTree(walker, child.Get(), depth + 1, maxDepth, out);
    ComPtr<IUIAutomationElement> next;
    if (FAILED(walker->GetNextSiblingElement(child.Get(), &next))) break;
    child = next;
  }
}

std::wstring ObservationText(IUIAutomation* automation, IUIAutomationElement* activeWindow, bool includeAccessibility, int maxDepth) {
  if (!includeAccessibility) return L"";
  ComPtr<IUIAutomationTreeWalker> walker;
  if (FAILED(automation->get_ControlViewWalker(&walker)) || !walker) return L"";
  std::wostringstream out;
  AppendTree(walker.Get(), activeWindow, 0, maxDepth, out);
  return out.str();
}

std::string ObservationJson(IUIAutomation* automation, IUIAutomationElement* activeWindow, bool includeAccessibility, int maxDepth) {
  const std::wstring windowTitle = ElementString(activeWindow, UIA_NamePropertyId);
  std::wstring application = ProcessName(activeWindow);
  if (application.empty()) application = windowTitle;
  const std::wstring visibleText = ObservationText(automation, activeWindow, includeAccessibility, maxDepth);
  std::ostringstream json;
  json << "{\"observation\":{";
  json << "\"application\":\"" << JsonEscape(application) << "\"";
  json << ",\"windowTitle\":\"" << JsonEscape(windowTitle) << "\"";
  if (!visibleText.empty()) json << ",\"visibleText\":\"" << JsonEscape(visibleText) << "\"";
  json << "}}";
  return json.str();
}

std::string ObservationJsonFromWindow(const CapturedWindow& window, const std::wstring& visibleText) {
  std::ostringstream json;
  json << "{\"observation\":{";
  json << "\"application\":\"" << JsonEscape(window.application) << "\"";
  json << ",\"windowTitle\":\"" << JsonEscape(window.windowTitle) << "\"";
  if (!visibleText.empty()) json << ",\"visibleText\":\"" << JsonEscape(visibleText) << "\"";
  json << "}}";
  return json.str();
}

bool InvokeElement(IUIAutomationElement* element) {
  ComPtr<IUnknown> unknown;
  if (FAILED(element->GetCurrentPattern(UIA_InvokePatternId, &unknown)) || !unknown) return false;
  ComPtr<IUIAutomationInvokePattern> invoke;
  if (FAILED(unknown.As(&invoke)) || !invoke) return false;
  return SUCCEEDED(invoke->Invoke());
}

bool SetElementValue(IUIAutomationElement* element, const std::wstring& text) {
  ComPtr<IUnknown> unknown;
  if (FAILED(element->GetCurrentPattern(UIA_ValuePatternId, &unknown)) || !unknown) return false;
  ComPtr<IUIAutomationValuePattern> value;
  if (FAILED(unknown.As(&value)) || !value) return false;
  BSTR bstr = SysAllocString(text.c_str());
  const bool ok = SUCCEEDED(value->SetValue(bstr));
  SysFreeString(bstr);
  return ok;
}

int Fail(const std::string& message) {
  std::cerr << message << std::endl;
  return 1;
}

int main() {
  const Request request = ParseRequest(ReadStdin());
  if (request.operation.empty()) return Fail("missing operation");

  const HRESULT co = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(co)) return Fail("failed to initialize COM");

  ComPtr<IUIAutomation> automation;
  HRESULT hr = CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&automation));
  if (FAILED(hr) || !automation) {
    CoUninitialize();
    return Fail("failed to create Microsoft UI Automation client");
  }

  HWND observationHwnd = nullptr;
  if (request.operation == "open_application") {
    if (!OpenApplication(request)) {
      CoUninitialize();
      return Fail("could not open requested application");
    }
    Sleep(500);
    HWND opened = FindRequestedWindow(request);
    if (opened) {
      observationHwnd = opened;
      FocusWindow(opened);
    }
  } else if (request.operation == "focus_application") {
    HWND targetWindow = FindRequestedWindow(request);
    if (!targetWindow || !FocusWindow(targetWindow)) {
      CoUninitialize();
      return Fail("requested application window was not found");
    }
    observationHwnd = targetWindow;
  } else if (request.operation == "minimize_application") {
    HWND targetWindow = FindRequestedWindow(request);
    if (!targetWindow) {
      CoUninitialize();
      return Fail("requested application window was not found");
    }
    observationHwnd = targetWindow;
    ShowWindow(targetWindow, SW_MINIMIZE);
  } else if (request.operation == "close_application") {
    HWND targetWindow = FindRequestedWindow(request);
    if (!targetWindow) {
      CoUninitialize();
      return Fail("requested application window was not found");
    }
    const CapturedWindow closedWindow = CaptureWindow(targetWindow);
    if (!PostMessageW(targetWindow, WM_CLOSE, 0, 0)) {
      CoUninitialize();
      return Fail("could not request close for application window");
    }
    if (!WaitForWindowClosed(request, targetWindow)) {
      CoUninitialize();
      return Fail("requested application window did not close");
    }
    std::cout << ObservationJsonFromWindow(closedWindow, L"closed");
    CoUninitialize();
    return 0;
  }

  ComPtr<IUIAutomationElement> activeWindow = ResolveActiveWindow(automation.Get());
  if (observationHwnd) {
    ComPtr<IUIAutomationElement> operationWindow;
    if (SUCCEEDED(automation->ElementFromHandle(observationHwnd, &operationWindow)) && operationWindow) {
      activeWindow = operationWindow;
    }
  }
  if (!activeWindow) {
    CoUninitialize();
    return Fail("could not determine the active Windows UI Automation element");
  }

  if (request.operation == "click" || request.operation == "type") {
    if (request.selector.empty()) {
      CoUninitialize();
      return Fail("missing selector");
    }
    ComPtr<IUIAutomationElement> target = FindTarget(automation.Get(), activeWindow.Get(), request.selector);
    if (!target) {
      CoUninitialize();
      return Fail("selector did not match an element");
    }
    if (request.operation == "click") {
      if (!InvokeElement(target.Get())) {
        CoUninitialize();
        return Fail("target does not support UIA InvokePattern");
      }
      Sleep(150);
    } else if (!SetElementValue(target.Get(), request.text)) {
      CoUninitialize();
      return Fail("target does not support UIA ValuePattern");
    }
  } else if (request.operation != "observe"
    && request.operation != "open_application"
    && request.operation != "focus_application"
    && request.operation != "minimize_application"
    && request.operation != "close_application") {
    CoUninitialize();
    return Fail("unsupported operation");
  }

  std::cout << ObservationJson(automation.Get(), activeWindow.Get(), request.includeAccessibility, request.maxDepth);
  CoUninitialize();
  return 0;
}

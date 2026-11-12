param([string]$Workspace,[string]$VerifyLayout,[switch]$VerifyController)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
public class BedazzleApprovalForm : System.Windows.Forms.Form {
    public bool PreviewOnly;
    protected override bool ShowWithoutActivation { get { return PreviewOnly; } }
}
'@
$appRoot = $PSScriptRoot
if (-not $Workspace) {
    $Workspace = Join-Path $appRoot 'workspace\bedazzle'
    $previousWorkspace = Join-Path $appRoot 'workspace\fieldwork'
    if (Test-Path -LiteralPath (Join-Path $previousWorkspace 'preferences.sqlite3')) { $Workspace = $previousWorkspace }
}
$script:workspaceSelection = ''
function Invoke-Control($request) {
    $request.workspace = $Workspace
    if ($script:workspaceSelection -and $request.action -ne 'list') { $request.expected_workspace = $script:workspaceSelection }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $appRoot 'runtime\python\python.exe'
    $start.Arguments = '-X utf8 "' + (Join-Path $appRoot 'companion_control.py') + '"'
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $start.StandardOutputEncoding = $utf8; $start.StandardErrorEncoding = $utf8
    $process = New-Object System.Diagnostics.Process; $process.StartInfo = $start
    try {
        [void]$process.Start()
        $writer = New-Object System.IO.StreamWriter($process.StandardInput.BaseStream, $utf8)
        $writer.Write(($request | ConvertTo-Json -Depth 30 -Compress)); $writer.Close()
        $output = $process.StandardOutput.ReadToEnd(); $errorText = $process.StandardError.ReadToEnd(); $process.WaitForExit()
        $result = $output | ConvertFrom-Json
        if ($process.ExitCode -ne 0 -or $result.error) { throw ($result.error + $errorText) }
        return $result
    } finally { $process.Dispose() }
}
function Show-Error($errorValue) { [void][System.Windows.Forms.MessageBox]::Show([string]$errorValue,'Bedazzle',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) }
function Confirm-Action($text) { return [System.Windows.Forms.MessageBox]::Show($text,'Review local authorization',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Warning) -eq [System.Windows.Forms.DialogResult]::Yes }
function New-Label($parent,$text,$x,$y,$w=760) { $v=New-Object System.Windows.Forms.Label; $v.Text=$text; $v.SetBounds($x,$y,$w,24); $parent.Controls.Add($v); return $v }
function New-Button($parent,$text,$x,$y,$w=170) { $v=New-Object System.Windows.Forms.Button; $v.Text=$text; $v.AccessibleName=$text; $v.SetBounds($x,$y,$w,32); $parent.Controls.Add($v); return $v }
function New-Text($parent,$x,$y,$w,$h) { $v=New-Object System.Windows.Forms.TextBox; $v.Multiline=$true; $v.ScrollBars='Vertical'; $v.SetBounds($x,$y,$w,$h); $parent.Controls.Add($v); return $v }
$form=New-Object BedazzleApprovalForm; $form.Font=New-Object System.Drawing.Font('Segoe UI',9.5); $form.PreviewOnly=[bool]$VerifyLayout; $form.Text='Bedazzle - local tasks and approvals'; $form.Size=New-Object System.Drawing.Size(860,720); $form.MinimumSize=New-Object System.Drawing.Size(700,560); $form.StartPosition='CenterScreen'
$location=New-Label $form ('Workspace home: '+$Workspace) 12 12 810
$tabs=New-Object System.Windows.Forms.TabControl; $tabs.SetBounds(12,44,820,620); $tabs.Anchor='Top,Bottom,Left,Right'; $form.Controls.Add($tabs)
$taskPage=New-Object System.Windows.Forms.TabPage; $taskPage.Text='Start task'; $tabs.TabPages.Add($taskPage)
[void](New-Label $taskPage 'Folders Claude may inspect (original files remain unchanged):' 12 14)
$folders=New-Object System.Windows.Forms.ListBox; $folders.SetBounds(12,42,770,100); $folders.AccessibleName='Permitted folders'; $taskPage.Controls.Add($folders)
$add=New-Button $taskPage 'Add folder...' 12 150
$remove=New-Button $taskPage 'Remove folder' 192 150
$add.Add_Click({ $picker=New-Object System.Windows.Forms.FolderBrowserDialog; try {if($picker.ShowDialog() -eq 'OK'){[void]$folders.Items.Add($picker.SelectedPath)}}finally{$picker.Dispose()} })
$remove.Add_Click({if($folders.SelectedIndex -ge 0){$folders.Items.RemoveAt($folders.SelectedIndex)}})
[void](New-Label $taskPage 'Describe the work you authorize:' 12 198)
$scope=New-Text $taskPage 12 226 770 100; $scope.AccessibleName='Task scope'; $scope.Text='Inspect the selected datasets and report data-quality findings.'
$workspaceCheck=New-Object System.Windows.Forms.CheckBox; $workspaceCheck.Text='Also allow inspection of stored tables in this workspace';$workspaceCheck.SetBounds(12,340,770,28);$taskPage.Controls.Add($workspaceCheck)
$privateCheck=New-Object System.Windows.Forms.CheckBox; $privateCheck.Text='Allow image requests to private/internal network addresses';$privateCheck.SetBounds(12,374,770,28);$taskPage.Controls.Add($privateCheck)
$downloadCheck=New-Object System.Windows.Forms.CheckBox; $downloadCheck.Text='Allow dataset downloads from private/internal network addresses';$downloadCheck.SetBounds(12,408,770,28);$taskPage.Controls.Add($downloadCheck)
[void](New-Label $taskPage 'Default model transfer: 1 MiB per task, 200 rows / 64 KiB per response.' 12 444)
[void](New-Label $taskPage 'Starting a task does not approve edits or corrected-copy analysis.' 12 468)
$create=New-Button $taskPage 'Review and start task' 12 510 240
$reviewPage=New-Object System.Windows.Forms.TabPage; $reviewPage.Text='Pending approvals'; $tabs.TabPages.Add($reviewPage)
$requests=New-Object System.Windows.Forms.ComboBox; $requests.DropDownStyle='DropDownList';$requests.SetBounds(12,18,770,30);$reviewPage.Controls.Add($requests)
$requestText=New-Text $reviewPage 12 60 770 420; $requestText.ReadOnly=$true;$requestText.AccessibleName='Exact approval request'
$approve=New-Button $reviewPage 'Approve this request' 12 495 230
$deny=New-Button $reviewPage 'Deny this request' 252 495 200
$refresh=New-Button $reviewPage 'Refresh' 582 495 200
$resolve=New-Button $reviewPage 'Review interrupted operation' 12 538 320
$budgetPage=New-Object System.Windows.Forms.TabPage; $budgetPage.Text='Tasks and transfer'; $tabs.TabPages.Add($budgetPage)
$tasks=New-Object System.Windows.Forms.ComboBox;$tasks.DropDownStyle='DropDownList';$tasks.SetBounds(12,18,770,30);$budgetPage.Controls.Add($tasks)
$taskText=New-Text $budgetPage 12 58 770 140;$taskText.ReadOnly=$true
[void](New-Label $budgetPage 'New cumulative transfer allowance (bytes):' 12 212)
$amount=New-Text $budgetPage 12 240 230 28;$amount.Multiline=$false;$amount.Text='4194304'
[void](New-Label $budgetPage 'Per response (bytes):' 282 212 230)
$perCall=New-Text $budgetPage 282 240 230 28;$perCall.Multiline=$false;$perCall.Text='65536'
[void](New-Label $budgetPage 'Maximum rows:' 552 212 230)
$rowLimit=New-Text $budgetPage 552 240 230 28;$rowLimit.Multiline=$false;$rowLimit.Text='200'
[void](New-Label $budgetPage 'Reason for additional transfer:' 12 280)
$reason=New-Text $budgetPage 12 308 770 74
$increase=New-Button $budgetPage 'Review transfer increase' 12 402 240
$close=New-Button $budgetPage 'Close selected task' 272 402 240
[void](New-Label $budgetPage 'Transfer approval grants no editing or corrected-copy analysis permission.' 12 454)
$restart=New-Button $budgetPage 'Restart background engine' 12 494 280
[void](New-Label $budgetPage 'After an app update: restart only when jobs are finished. No main window opens.' 12 536)
function Refresh-Control {
    $script:controlState=Invoke-Control @{action='list'}; $script:workspaceSelection=$script:controlState.workspace
    $location.Text='Selected workspace: '+$script:workspaceSelection
    $requests.Items.Clear();$tasks.Items.Clear();$requestText.Clear();$taskText.Clear()
    foreach($item in $script:controlState.approvals){[void]$requests.Items.Add(($item.status+' / '+$item.purpose+' - '+$item.id))}
    foreach($item in $script:controlState.tasks){[void]$tasks.Items.Add(($item.scope+' - '+$item.id))}
    if($requests.Items.Count){$requests.SelectedIndex=0};if($tasks.Items.Count){$tasks.SelectedIndex=0}
}
$requests.Add_SelectedIndexChanged({if($requests.SelectedIndex -ge 0){$requestText.Text=$script:controlState.approvals[$requests.SelectedIndex] | ConvertTo-Json -Depth 30}})
$tasks.Add_SelectedIndexChanged({if($tasks.SelectedIndex -ge 0){$taskText.Text=$script:controlState.tasks[$tasks.SelectedIndex] | ConvertTo-Json -Depth 20}})
$refresh.Add_Click({try{Refresh-Control}catch{Show-Error $_}})
$create.Add_Click({try{
    $selectedFolders=@($folders.Items | ForEach-Object {[string]$_})
    if(-not $selectedFolders.Count -or -not $scope.Text.Trim()){throw 'Choose a folder and describe the work first.'}
    $summaryText='Start this task in '+$script:workspaceSelection+"?`r`n"+$scope.Text+"`r`nFolders: "+($selectedFolders -join ', ')+"`r`nWorkspace tables: "+$workspaceCheck.Checked+"`r`nPrivate image network: "+$privateCheck.Checked+"`r`nPrivate dataset network: "+$downloadCheck.Checked
    if(Confirm-Action $summaryText){$result=Invoke-Control @{action='task';folders=$selectedFolders;scope=$scope.Text;workspace_data=$workspaceCheck.Checked;private_images=$privateCheck.Checked;private_downloads=$downloadCheck.Checked};Refresh-Control;[void][System.Windows.Forms.MessageBox]::Show(('Task started: '+$result.id),'Bedazzle')}
}catch{Show-Error $_}})
function Decide-Request($decision){
    if($requests.SelectedIndex -lt 0){return};$selected=$script:controlState.approvals[$requests.SelectedIndex]
    if(Confirm-Action ($decision.ToUpper()+" exactly the request displayed?`r`nPurpose: "+$selected.purpose+"`r`nID: "+$selected.id)){
        [void](Invoke-Control @{action='review';id=$selected.id;fingerprint=$selected.fingerprint;decision=$decision});Refresh-Control
    }
}
$approve.Add_Click({try{Decide-Request 'approved'}catch{Show-Error $_}})
$deny.Add_Click({try{Decide-Request 'denied'}catch{Show-Error $_}})
$resolve.Add_Click({try{
    if($requests.SelectedIndex -lt 0){return};$selected=$script:controlState.approvals[$requests.SelectedIndex]
    if(Confirm-Action ('This operation may already have written data. Inspect its destination, receipts and backups first. Have you reviewed the outcome and want to abandon this attempt and create a NEW, unapproved retry proposal? Nothing will rerun now.')){
        [void](Invoke-Control @{action='resolve';id=$selected.id;fingerprint=$selected.fingerprint});Refresh-Control
    }
}catch{Show-Error $_}})
$increase.Add_Click({try{
    if($tasks.SelectedIndex -lt 0){return};$selected=$script:controlState.tasks[$tasks.SelectedIndex]
    if(Confirm-Action ('Increase transfer for '+$selected.id+' to '+$amount.Text+' total bytes, '+$perCall.Text+' bytes per call, '+$rowLimit.Text+' rows? Reason: '+$reason.Text)){
        [void](Invoke-Control @{action='transfer';task=$selected.id;bytes=[long]$amount.Text;response_bytes=[long]$perCall.Text;rows=[int]$rowLimit.Text;reason=$reason.Text});Refresh-Control
    }
}catch{Show-Error $_}})
$close.Add_Click({try{if($tasks.SelectedIndex -ge 0){$selected=$script:controlState.tasks[$tasks.SelectedIndex];if(Confirm-Action ('End task access for '+$selected.id+'? This blocks further model transfers. Running jobs are not cancelled; use Cancel Claude job separately if needed.')){[void](Invoke-Control @{action='close';task=$selected.id});Refresh-Control}}}catch{Show-Error $_}})
$restart.Add_Click({try{if(Confirm-Action 'Restart the Bedazzle background engine now? Saved data/results remain. Temporary SQL session objects will reset. Running jobs block this action.'){$result=Invoke-Control @{action='restart'};[void][System.Windows.Forms.MessageBox]::Show($result.message,'Bedazzle')}}catch{Show-Error $_}})
$form.Add_Shown({if(-not $VerifyLayout){try{Refresh-Control}catch{Show-Error $_}}})
foreach($page in $tabs.TabPages){$page.AutoScroll=$true}
if($VerifyLayout){
    $form.ShowInTaskbar=$false;$form.StartPosition='Manual';$form.Location=New-Object System.Drawing.Point(-30000,-30000)
    $form.Show();[System.Windows.Forms.Application]::DoEvents();$form.PerformLayout()
    $bitmap=New-Object System.Drawing.Bitmap($form.Width,$form.Height)
    try{$form.DrawToBitmap($bitmap,(New-Object System.Drawing.Rectangle(0,0,$form.Width,$form.Height)));$bitmap.Save($VerifyLayout,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
    @{tabs=$tabs.TabPages.Count;width=$form.Width;height=$form.Height;taskButton=$create.AccessibleName;approvalButton=$approve.AccessibleName} | ConvertTo-Json -Compress
}elseif($VerifyController){Invoke-Control @{action='list'} | ConvertTo-Json -Depth 30 -Compress}
else{[void]$form.ShowDialog()}
$form.Dispose()

$maintenanceStartDateTime = Read-Host 'Enter the time the deployment has to start(To remove a previously sent maintenance alert, just press Enter). Enter in the following format(in ET): yyyy/MM/dd HH:mm Ex:2021/01/18 10:00 EST'

#Update the host url(with scheme) of Sitecore Authoring instance below
$sitecoreHostUrl = 'https://xp100sc.dev.local/'

#Below default VAPID Private Key & Sitecore API Key can be used for testing, but needs to be updated for production purposes as described in the documentation
$vapidPrivateKey = 'S_gE7nHU2t9qwiwjsVIvsFGwiprAPkRTGhhFRP5H6_o'
$sitecoreAPIKey = '7FB707AA-A231-45F7-AB22-77407AB9A5C6'

function Get-ItemResponse($itemId){
    $oDataItemServicesLink =  "$sitecoreHostUrl/sitecore/api/ssc/aggregate/content/Items('$itemId')?sc_apikey=$sitecoreAPIKey&%24expand=Fields"
    return Invoke-WebRequest -Uri $oDataItemServicesLink | ConvertFrom-Json
}
function Send-PushNotifications($message, $ttl) {
    $pushSubscriptionsItemResponse.Fields.Value.Split('&') | ForEach-Object { 
	    $pushSubscription = $_.Split('=')[1] | ConvertFrom-Json
	    $endpoint = $pushSubscription.endpoint.Replace('%3D', '=').Replace('%#', '%3')
	    $p256dh = $pushSubscription.keys.p256dh.Replace('%3D', '=').Replace('%#', '%3')
	    $auth = $pushSubscription.keys.auth.Replace('%3D', '=').Replace('%#', '%3')
	    web-push send-notification --endpoint=$endpoint --key=$p256dh --auth=$auth --payload=$message --vapid-subject=$sitecoreHostUrl --vapid-pubkey=$vapidPublicKey --vapid-pvtkey=$vapidPrivateKey --ttl=$ttl
    }
}
function Get-StatusCode{
    try{
        $ProgressPreference = 'SilentlyContinue' 
        $statusCode = (Invoke-WebRequest -Uri $sitecoreHostUrl -UseBasicParsing -DisableKeepAlive).StatusCode
        $ProgressPreference = 'Continue'
        return $statusCode  
    }
    catch{
        Start-Sleep 60
        return 0
    }
}

$notificationSettingsItemId = '{568478C7-6FAA-43FF-A53B-D6BD5C63A665}'
$notificationSettingsItemResponse = Get-ItemResponse -itemId $notificationSettingsItemId
$vapidPublicKey = ($notificationSettingsItemResponse.Fields | Where-Object Name -Eq "PublicKey").Value
$reminderTime = [int]($notificationSettingsItemResponse.Fields | Where-Object Name -Eq "ReminderTime").Value*60
$reminderMessage = ($notificationSettingsItemResponse.Fields | Where-Object Name -Eq "ReminderMessage").Value
$maintenanceDuration = [int]($notificationSettingsItemResponse.Fields | Where-Object Name -Eq "MaintenanceDuration").Value*60*60
$completionMessage = ($notificationSettingsItemResponse.Fields | Where-Object Name -Eq "CompletionMessage").Value

$pushSubscriptionsItemId = '{97A2ACEA-2520-4EC8-8152-94EE8D238ABF}'
$pushSubscriptionsItemResponse = Get-ItemResponse -itemId $pushSubscriptionsItemId

if($maintenanceStartDateTime -eq ''){
    npm install web-push --save -g
    Send-PushNotifications -message $maintenanceStartDateTime -ttl 604800
}
else{
    #Update Timezone ID and Daylight Savings Offset values based on expected Timezone of maintenanceStartDateTime input variable
    #Please note that only few Timezones will be supported by Browsers (Eg:UTC,GMT,EST/EDT,CST/CDT,MST/MDT,PST/PDT), hence maintenanceDateTimeExact must be in supported Timezone for notifications to work
    $isDST = ([System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), [System.TimeZoneInfo]::FindSystemTimeZoneById("Eastern Standard Time"))).IsDaylightSavingTime()
    $DST_offset = $(if($isDST) {"4"} else {"5"})
    $maintenanceStartDateTime = $maintenanceStartDateTime -replace '[a-zA-Z]', ''
    $maintenanceDateTimeExact = $maintenanceStartDateTime + $(if($isDST) {" EDT"} else {" EST"})
    $waitUntil = (New-TimeSpan –End (Get-Date -Date "$($maintenanceStartDateTime.ToString())Z").AddHours($DST_offset))
    $ttl = ([int]$waitUntil.TotalSeconds + $maintenanceDuration)

    if([int]$waitUntil.TotalMinutes -gt 0)
    {
        npm install web-push --save -g
        Send-PushNotifications -message $maintenanceDateTimeExact -ttl $ttl
        Write-Host 'Scheduled Maintenance Notifications sent to all subscribed Content Authors and Marketers' -ForegroundColor Cyan

        if($waitUntil.TotalHours -gt 1){
            Write-Host "Deployment will begin in $([math]::Floor($waitUntil.TotalHours)) hour(s) and $([math]::Floor($waitUntil.Minutes)) minute(s)..."
        }
        else{
            Write-Host "Deployment will begin in $([math]::Floor($waitUntil.TotalMinutes)) minute(s)..."
        }
        ($waitUntil.TotalSeconds - $reminderTime) | Sleep;

        Send-PushNotifications -message $reminderMessage -ttl $reminderTime
        Write-Host 'Scheduled Maintenance Reminders sent to all subscribed Content Authors and Marketers' -ForegroundColor Cyan

        $statusCode
        DO{
            $statusCode = Get-StatusCode
        } Until ($statusCode -ne 200)
        Write-Host 'Maintenance in progress.. Sitecore is currently unavailable' -ForegroundColor Yellow

        DO{
            $statusCode = Get-StatusCode
        } Until ($statusCode -eq 200)

        Send-PushNotifications -message $completionMessage -ttl 3600
        Write-Host 'Maintenance Completion Notification sent to all subscribed Content Authors and Marketers' -ForegroundColor Green
    }
}
pause



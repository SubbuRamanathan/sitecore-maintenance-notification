#Update the host url(with scheme) of Sitecore Authoring instance below
$sitecoreHostUrl = '$(sitecoreHostUrl)' #'https://xp100sc.dev.local/'

#Below commented default VAPID Private Key & Sitecore API Key can be used for testing, but needs to be updated for production purposes as described in the documentation
$vapidPrivateKey = '$(vapidPrivateKey)' #'S_gE7nHU2t9qwiwjsVIvsFGwiprAPkRTGhhFRP5H6_o'
$sitecoreAPIKey = '$(sitecoreAPIKey)' #'7FB707AA-A231-45F7-AB22-77407AB9A5C6'

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

$notificationSettingsItemId = '{568478C7-6FAA-43FF-A53B-D6BD5C63A665}'
$notificationSettingsItemResponse = Get-ItemResponse -itemId $notificationSettingsItemId
$vapidPublicKey = ($notificationSettingsItemResponse.Fields | Where-Object Name -Eq "PublicKey").Value
$completionMessage = ($notificationSettingsItemResponse.Fields | Where-Object Name -Eq "CompletionMessage").Value

$pushSubscriptionsItemId = '{97A2ACEA-2520-4EC8-8152-94EE8D238ABF}'
$pushSubscriptionsItemResponse = Get-ItemResponse -itemId $pushSubscriptionsItemId

Invoke-RestMethod -TimeoutSec 300 -Uri "$sitecoreHostUrl/sitecore"
Send-PushNotifications -message $completionMessage -ttl 3600
Write-Host 'Maintenance Completion Notification sent to all subscribed Content Authors and Marketers' -ForegroundColor Green




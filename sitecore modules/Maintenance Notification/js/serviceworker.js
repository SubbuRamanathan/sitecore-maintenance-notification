const HOST_URL = `${self.location.origin}/sitecore`
const NOTIFICATIONSETTINGS_ITEMSERVICESLINK = '/sitecore/api/ssc/item/568478C7-6FAA-43FF-A53B-D6BD5C63A665?database=master'
const PUSHSUBSCRIPTIONS_ITEMSERVICESLINK = '/sitecore/api/ssc/item/97A2ACEA-2520-4EC8-8152-94EE8D238ABF?database=master'
const CACHE_NAME = 'offline'
const OFFLINE_URL = '/sitecore modules/Maintenance Notification/offline.html'

//Import IDB-Keyval library for storing maintenance details in IndexedDB, in order to retain details even if there is a system/browser restart
if (typeof idbKeyval === "undefined") {
	self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/idb-keyval/3.2.0/idb-keyval-iife.min.js');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
	//Store Maintenance Page in Browser Cache Storage, to display during maintenance when server/site is not reachable
    const cache = await caches.open(CACHE_NAME);
    await cache.add(new Request(OFFLINE_URL, {cache: 'reload'}));
  })());
});
self.addEventListener('activate', async (event) => {
	try {
		event.waitUntil(
			self.clients.claim()
		)		
		await fetchAndStoreSubscription()
		await initializeNotificationSettings()
	} catch (error) {
		console.log('Error', error)
	}
})
const fetchAndStoreSubscription = async () => {
	const notificationSettingsItemResponse = await fetch(NOTIFICATIONSETTINGS_ITEMSERVICESLINK)
	const publicKey = (await notificationSettingsItemResponse.json()).PublicKey
	const applicationServerKey = urlBase64ToUint8Array(publicKey)
	const options = { applicationServerKey, userVisibleOnly: true }
	await idbKeyval.set('isSubscriptionRemoved', true)
	
	//Format Subscription for storing in Sitecore PushSubscriptions field
	const subscription = JSON.stringify(await self.registration.pushManager.subscribe(options))
		.replace('%3d', '%#d').replace('%3D', '%#D').replace('=', '%3D')
	await idbKeyval.set('subscription', subscription)
	await saveSubscription(subscription)
	await idbKeyval.set('isSubscriptionRemoved', false)
}
const urlBase64ToUint8Array = base64String => {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
	const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/')
	const rawData = atob(base64)
	const outputArray = new Uint8Array(rawData.length)
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i)
	}
	return outputArray
}
const saveSubscription = async subscription => {
	const pushSubscriptions = await getSubscriptions()
	const updatedPushSubscriptions = `${(pushSubscriptions == '') ? '' : pushSubscriptions + '&'}${Date()}=${subscription}`
	postSubscriptions(updatedPushSubscriptions)
}
const getSubscriptions = async () => {
	const pushSubscriptionsItemResponse = await fetch(PUSHSUBSCRIPTIONS_ITEMSERVICESLINK)
	return (await pushSubscriptionsItemResponse.json()).PushSubscriptions	
}
const postSubscriptions = async (pushSubscriptions) => {
	var pushSubscription = new Object()
	pushSubscription.PushSubscriptions = pushSubscriptions
	await fetch(PUSHSUBSCRIPTIONS_ITEMSERVICESLINK, {
		method: 'PATCH',
		headers: {
		  'Content-Type': 'application/json',
		},
		body: JSON.stringify(pushSubscription),
	})
}


self.addEventListener('fetch', async (event) => {
	if (event.request.mode === 'navigate' && event.request.destination == 'document' && 
			event.request.url.indexOf(HOST_URL) != -1 && event.request.url.indexOf('/api/') == -1) {
		event.respondWith((async () => {
			let networkResponse
			try {
				networkResponse = await fetch(event.request);
				if(await idbKeyval.get('isSubscriptionRemoved')){
					await fetchAndStoreSubscription()
				}
				await initializeNotificationSettings()
				if(await isMaintenanceCompleted()){
					await idbKeyval.set('isMaintenanceScheduled', false)
				}
			} catch (error) {
				if((await idbKeyval.get('isMaintenanceScheduled')) && (await isMaintenanceStarted()) && !(await isMaintenanceCompleted())){
					console.log('Fetch failed for ', event.request.url, 'Returning Scheduled Maintenance Page', error);
					
					const cache = await caches.open(CACHE_NAME);
					const cachedResponse = await cache.match(OFFLINE_URL);
					return cachedResponse;
				}
				return; 
			}
			try {
				let responseBody = await updateResponseText(event.request, networkResponse)
				return new Response(responseBody, {
					status: networkResponse.status,
					statusText: networkResponse.statusText,
					headers: networkResponse.headers
				})
			} catch (error) {
				console.log('Updating Response failed for ', event.request.url, error)
				return networkResponse
			}
		})());
	}
})
const showLocalNotification = (title, body, serviceWorkerRegistration) => {
	const options = {
		body,
		icon: 'https://subbu.ca/wp-content/uploads/sitecore-logo.png',
        vibrate: [100, 50, 100]
	}
	serviceWorkerRegistration.showNotification(title, options)
}
const updateResponseText = async (request, response) => {
	let responseBody = await response.text()
	if(request.url.indexOf('ControlPanel.aspx') > 0)
		responseBody = updateSubscribeText(responseBody)
	const isMaintenanceMessageIgnored = await idbKeyval.get('isMaintenanceMessageIgnored')
	if((await idbKeyval.get('isMaintenanceScheduled')) && !(await isMaintenanceCompleted()) && !isMaintenanceMessageIgnored)
		return includeNotificationBanner(responseBody)
	return responseBody
}
const updateSubscribeText = (responseText) => {
	return responseText.replace('Subscribe to Scheduled Maintenance Notifications', 'Unsubscribe from Scheduled Maintenance Notifications');
}
const includeNotificationBanner = async (responseText) => {
	let bodyTag = responseText.match(/<\s*body[^>]*>/g);
	if(bodyTag){
		const maintenanceMessage = await idbKeyval.get('maintenanceMessage')
		
		const notificationBannerHtml = `<div style='background: #DC291E;color: white;font-weight: bold;text-transform: uppercase;text-align: center;padding: 5px 0px;position: fixed;z-index: 100;width: 100%;'>${maintenanceMessage}<span id='notificationClose' style='float: right;padding: 0px 10px;cursor: pointer;' onclick='event.target.parentElement.remove();navigator.serviceWorker.controller.postMessage("maintenanceMessageIgnored");'>x</span></div>`
		
		return responseText.replace(bodyTag[0], bodyTag[0] + notificationBannerHtml);
	}
	return responseText
}


self.addEventListener('push', async (event) => {
	if (event.data) {
		const pushMessage = event.data.text()
		const completionMessage = await idbKeyval.get('completionMessage')
		const reminderMessage = await idbKeyval.get('reminderMessage')
		if(pushMessage == reminderMessage || pushMessage == completionMessage){
			showLocalNotification(await idbKeyval.get('notificationTitle'), pushMessage, self.registration)
			if(pushMessage == completionMessage){
				await idbKeyval.set('isMaintenanceMessageIgnored', true);
				clients.matchAll({includeUncontrolled: true}).then( windowClients => {
					for (var i = 0; i < windowClients.length; i++) {
						var client = windowClients[i];
						if (client.url.indexOf(HOST_URL) != -1) {
							client.navigate(client.url);
						}
					}
				})
			}
		}
		else{
			await initializeNotificationSettings()
			await getNotificationMessage(pushMessage)
			if((await idbKeyval.get('isMaintenanceScheduled')) && !(await isMaintenanceStarted())){
				showLocalNotification(await idbKeyval.get('notificationTitle'), await idbKeyval.get('maintenanceMessage'), self.registration)
			}
		}
	} else {
		console.log('Push event but no data')
		await idbKeyval.del('maintenanceMessage')
		await idbKeyval.del('maintenanceEndDateTime')
		await idbKeyval.del('isMaintenanceMessageIgnored')
		await idbKeyval.del('isMaintenanceScheduled')
		await idbKeyval.del('maintenanceStartDateTime')
	}
})

const initializeNotificationSettings = async () => {
	try{
		const notificationSettingsItemResponse = await fetch(NOTIFICATIONSETTINGS_ITEMSERVICESLINK)
		const notificationSettings = await notificationSettingsItemResponse.json()
		const maintenanceDuration = parseInt(notificationSettings.MaintenanceDuration)
		
		await idbKeyval.set('notificationTitle', notificationSettings.NotificationTitle)
		await idbKeyval.set('completionMessage', notificationSettings.CompletionMessage)
		await idbKeyval.set('reminderMessage', notificationSettings.ReminderMessage)
		await idbKeyval.set('maintenanceMessageFormat', notificationSettings.MaintenanceMessageFormat)
		await idbKeyval.set('maintenanceDuration', notificationSettings.MaintenanceDuration)
	}
	catch(error){
		console.log('Fetching Notification Settings from Sitecore failed ', error)
	}
}
const getNotificationMessage = async (startDateTime) => {
	const maintenanceStartDateTime = new Date(startDateTime)
	if(!isNaN(maintenanceStartDateTime)){
		await idbKeyval.set('isMaintenanceScheduled', true)
		await idbKeyval.set('maintenanceStartDateTime', maintenanceStartDateTime)
		let maintenanceEndDateTime = new Date(maintenanceStartDateTime.getTime())
		const maintenanceDuration = parseInt(await idbKeyval.get('maintenanceDuration'))
		maintenanceEndDateTime.setHours(maintenanceEndDateTime.getHours() + maintenanceDuration)
		
		date = maintenanceStartDateTime.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
		day = maintenanceStartDateTime.toLocaleDateString(undefined, { weekday: 'long' })
		startTime = maintenanceStartDateTime.toLocaleString([], { hour: '2-digit', minute:'2-digit'})
		endTime = maintenanceEndDateTime.toLocaleString([], { hour: '2-digit', minute:'2-digit'})
		timeZone = '(' + maintenanceStartDateTime.toTimeString().match(/\((.*)/).pop()
		const maintenanceMessageFormat = await idbKeyval.get('maintenanceMessageFormat')
		maintenanceMessage = maintenanceMessageFormat.replace('{date}', date).replace('{day}', day)
			.replace('{startTime}', startTime).replace('{endTime}', endTime).replace('{timeZone}', timeZone);
		
		await idbKeyval.set('maintenanceMessage', maintenanceMessage)
		await idbKeyval.set('maintenanceEndDateTime', maintenanceEndDateTime)
		await idbKeyval.set('isMaintenanceMessageIgnored', false)
	}
	else{
		console.log("Invalid Maintenance Start Date")
	}
}


self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({includeUncontrolled: true}).then( windowClients => {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url.indexOf(HOST_URL) != -1 && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(HOST_URL);
            }
        })
    );
});


self.addEventListener('message', async (event) => {
	switch(event.data){
		case 'maintenanceMessageIgnored':
			await idbKeyval.set('isMaintenanceMessageIgnored', true);
			break;
		case 'unregister':
			self.registration.unregister();
			await idbKeyval.set('isSubscriptionRemoved', true)
				
			let pushSubscriptions = await getSubscriptions();
			const subscription = await idbKeyval.get('subscription')
			pushSubscriptions = pushSubscriptions.split('&').filter(p => p.indexOf(subscription) < 0).join('&')
			postSubscriptions(pushSubscriptions);
			break;
	}
})

const isMaintenanceStarted = async () => {
	const maintenanceStartDateTime = await idbKeyval.get('maintenanceStartDateTime')
	return maintenanceStartDateTime < new Date();
}
const isMaintenanceCompleted = async () => {
	const maintenanceEndDateTime = await idbKeyval.get('maintenanceEndDateTime')
	return maintenanceEndDateTime < new Date();
}
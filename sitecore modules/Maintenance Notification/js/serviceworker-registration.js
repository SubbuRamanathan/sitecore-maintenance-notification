const subscribeText = 'Subscribe to Scheduled Maintenance Notifications'
const unsubscribeText = 'Unsubscribe from Scheduled Maintenance Notifications'

const validateBrowserSupport = () => {
  if (!('serviceWorker' in navigator)) {
    throw new Error('No Service Worker support!')
  }
  if (!('PushManager' in window)) {
    throw new Error('No Push API Support!')
  }
}
const registerServiceWorker = async () => {
  const serviceWorkerRegistration = await navigator.serviceWorker.register('/sitecore modules/Maintenance Notification/js/serviceworker.js', {scope: '/'})
  return serviceWorkerRegistration
}
const requestNotificationPermission = async () => {
  const permission = await window.Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Permission not granted for Notification')
  }
}
const main = async () => {
  let registrations = await navigator.serviceWorker.getRegistrations()
  if(registrations.length > 0){
	navigator.serviceWorker.controller.postMessage("unregister")
	updateSubscribeText(unsubscribeText,subscribeText)
  }
  else{	
    validateBrowserSupport()
    const serviceWorkerRegistration = await registerServiceWorker()
    const permission = await requestNotificationPermission()
	updateSubscribeText(subscribeText,unsubscribeText)
  }
}
const updateSubscribeText = (fromText, toText) => {
	var xpath = `//a[text()='${fromText}']`
	var subscribeLink = document.evaluate(xpath, window.top.document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
	subscribeLink.innerText = toText
}
main();
/**
* Javascript controller of a room. Most of the function related to functionnalities were here. Please see the * factory documentation for non-native objects.
* @constructor
* @param {function} $scope - Enable to focus a component. See Angular doc for further informations
* @param {string} $location - Set the current path (to complete)
* @param {object} $window - Enable the controller to access to the browser window
* @param {String{} $params - Contain the main parameters of the room such as RoomName
* @param {object} $timeout - Enable to set a timeout related to a function such as the dropdown animation
* @param {Socket} socket - See socket.js
* @param {Constraints} constraints - See constraints.js
* @param {object} notifications - Object containing required functionnalities to use notifications
* @param {object} progress - Native object in charge of the loading circle
* @param {Participant{}} - Dictionnary of the current participant 
*/
function RoomCtrl($scope, $rootScope, $location, $window, $params, $timeout, socket, constraints, notifications, progress, participants) {

    /**
    *Room initialisation
    */
    
	if (participants.isEmpty())
		$location.path('/');
    
	socket.roomReady();

	$scope.roomName = $params.roomName;

	//FOR SIP MERGING / DO NOT EXIST IN SIP BRANCH  : $scope.lineAvailable = false;
    $scope.lineAvailable = false;
    
	$scope.lineExtension = '';

	$scope.presentation = {
		active: false,
		presenterIsMe: false,
		disabled: {
			all: function() {
				this.general = true;
				this.screen = true;
				this.window = true;
				updateScope();
			},
			general: false,
			screen: false,
			window: false,
			none: function() {
				this.general = false;
				this.screen = false;
				this.window = false;
				updateScope();
			}
		}
	};

	$scope.participantNames = [];
    
    /**
    *End of initialisation
    */
    
    
    /**
    * The main function of this controller, every message received by the websocket was retrieved by this function and * the forsighten one is called.
    * @function 
    */
	socket.get().onmessage = function(message) {

		var parsedMessage = JSON.parse(message.data);
		console.info('Received message: ' + message.data);

		switch (parsedMessage.id) {

			case 'compositeInfo':
				sendStream(parsedMessage, 'composite');
				break;

			case 'presentationInfo':
				if (constraints.browserIsFirefox)
					sendStream(parsedMessage, 'presentation');
				break;

			case 'presenterReady':
				onPresenterReady(parsedMessage);
				break;

			case 'cancelPresentation':
				cancelPresentation(parsedMessage);
				break;

			case 'newParticipantArrived':
				onNewParticipant(parsedMessage);
				break;

			case 'participantLeft':
				onParticipantLeft(parsedMessage);
				break;

			case 'receiveVideoAnswer':
				receiveVideoResponse(parsedMessage);
				break;

			case 'existingPresentation':

				var warning = {
					title: 'Someone is currently presenting',
					content: 'You cannot present until the current presentation has finished.'
				};

				notifications.alert(warning.title, warning.content, 'Ok', function(answer) {
					// This should be handled by lumx (it must be a bug)
					// May be removed in the future
					$('.dialog-filter').remove();
					$('.dialog').remove();
				});

				$scope.stopPresenting();
				break;

			case 'existingName':

				constraints.setWarning(true);
				$scope.leave();

				break;

			case 'iceCandidate':

				participants.get(parsedMessage.userId).rtcPeer[parsedMessage.type].addIceCandidate(parsedMessage.candidate, function(error) {
					if (error) {
						console.error("Error adding candidate: " + error);
						return;
					}
				});

				break;

			case 'lineAvailable':
				setLineExtension(parsedMessage.extension);$scope.lineAvailable = false
				break;

			case 'callInformation':
				notifications.notify(parsedMessage.message);
				console.log(parsedMessage.message);
				break;
                
            case 'recordJava':
                recordJava(parsedMessage);
                break;
                
            case 'stopRecordJava':
                stopRecordJava(parsedMessage);
                break;
                
			default:
				console.log('Unrecognized message', parsedMessage);
		}
	};
    
    // Security function : insure that the participant will be destroyed if modifies the URL
	$scope.$on('$locationChangeStart', function(event) {
		leave();
	});

	// Configuration for the extension if it is Chrome
	if (constraints.browserIsChrome) {
		$window.addEventListener('message', function(event) {

			// user chose a stream
			if (event.data.type && (event.data.type === 'SS_DIALOG_SUCCESS')) {
				constraints.setId(event.data.streamId);
				sendStream({}, 'presentation');
			}

			// user clicked on 'cancel' in choose media dialog
			if (event.data.type && (event.data.type === 'SS_DIALOG_CANCEL')) {
				$scope.stopPresenting();
			}
		});
	}
    
    
    /**
    *Start of screensharing bloc 
    */
    
    //Stop the presentation since the button is clicked
	$scope.stopPresenting = function() {

		var participant = participants.me();

		if (participant !== undefined && participant.rtcPeer['presentation'] !== null) {
			participant.rtcPeer['presentation'].dispose();
			participant.rtcPeer['presentation'] = null;
		}

		$scope.presentation.presenterIsMe = false;
		constraints.setType('composite');
		socket.send({ id: 'stopPresenting' });
	};
    
    //Launch a screensharing meeting. HAD TO BE FINISHED
	$scope.share = function(type) {

		var currentType = constraints.getType();
		var success = true;

		// if there is already a presenter who is not me
		if ($scope.presentation.active && !$scope.presentation.presenterIsMe){
            console.log('A presentation is already running');
			return
        };

		// on Chrome, the extension handles window or screen
		if ((type != currentType || constraints.browserIsChrome) && constraints.canPresent) {

			if (currentType != 'composite')
				this.stopPresenting();

			if (constraints.browserIsChrome) {

				if (!constraints.isChromeExtensionInstalled()) {
					
					console.log('Extension need to be installed');
					
					var warning = {
						title: 'Chrome extension needed',
						content: 'To enable screensharing or window sharing, please use our extension.'
					};

					notifications.confirm(warning.title, warning.content, { cancel: 'Cancel', ok: 'Download'}, function(answer) {
						if (answer === true)
							$window.location = '/extension.crx';
					});

					success = false;

				} else {
					$window.postMessage({ type: 'SS_UI_REQUEST', text: 'start' }, '*');
				}

			}

			if (success) {

				constraints.setType(type);
				$scope.presentation.presenterIsMe = true;

				socket.send({
					id: 'newPresenter',
					userId: participants.me().userId,
					room: this.roomName,
					mediaSource: type
				});

			}
		}
	};
    
    //Check the ability of browser to perform a screensharing meeting
	$scope.canPresent = function(browser) {

		return (constraints.canPresent && browser == constraints.browser);

	};

    /**
    * ENd of screencharing blog
    */
    
    //Send the message to start a VOIP calling
	$scope.invite = function(number) {
		socket.send({
			id: 'invite',
			callee: number
		});
	};

    //When user click on leave button, call the function to kill his account
	$scope.leave = function() {
		leave();
		$location.path('/');
	};

    
    //Delete the user from the room
	function leave() {
		socket.send({ id: 'leaveRoom' });
		constraints.setType('composite');
		participants.clear();
	}
    
    //Print the error log on the console
    function onError(error) {
        if(error) console.log(error);
    }
    	
     /**
    *Recording bloc
    */

    //Function dedicated to the control of the recording state
    $scope.record = {
        recording: false,
        text: "RECORD",
        change: function() {
            if (!this.recording){
                recordJS();
            } else {
                stopRecordJS();
            };
            this.recording = !this.recording;
            this.text = (this.recording) ? "STOP_RECORD" : "RECORD";
            updateScope();
        },
        update: function() {
            this.recording = !this.recording;
            this.text = (this.recording) ? "STOP_RECORD" : "RECORD";
            updateScope();
        }
    };
    
    //Send the message to start the record using the websocket
    function recordJS() {
		console.log("Start record");
		socket.send({'id': 'record',
			     roomName: $params.roomName,
                 	     userId: participants.me().userId,
                         userName: participants.me().name});
	};
    
    //Send the message to stop the record using the websocket
	function stopRecordJS() {
		console.log("End record");
		socket.send({'id': 'stopRecord',
			     roomName: $params.roomName,
                 	     userId: participants.me().userId,
                         userName: participants.me().name});
	};  
                                                    
                                                          
    /**
    *End of recording bloc
    */
    
    /**
    *Start of the resolution setting bloc
    */
    
    /**
    * @function - setResolution() : change user resolution according param
    * @param number - width : width of the sending video
    * @param number - height : height of the sending video
    * @param boolean - isAuto : tru if the user wants an auto setting
    */
    $scope.setResolution = function (width, height, isAuto) {

        constraints.setRes(width, height, isAuto);
        if (isAuto) {
            if ($rootScope.langKey === 'en') {
            notifications.notify('Resolution auto adjustment', 'account-plus')
            } else if ($rootScope.langKey === 'fr') {
            notifications.notify('Ajustement automatique de la résolution', 'account-plus')    
            };  
            console.log('Resolution auto adjustment');
        } else {
            if ($rootScope.langKey === 'en') {
            notifications.notify('Resolution set to : '+width+' * '+height, 'account-plus');  
            } else if ($rootScope.langKey === 'fr') {
            notifications.notify('Resolution choisie : '+width+' * '+height, 'account-plus');      
            };
            console.log('Resolution set to : '+width+' * '+height);
        }
    };
    
    /**
    *End of the resolution setting bloc
    */
    
    /**
    * Start of media selection block
    */
    
	$scope.$on('$destroy', function() {
		constraints.setType('composite');
		participants.clear();
	});
    
	function renewConstraints(compositeOptions) {
		var participant = participants.me();
		participant.disposeType('composite');
		socket.send({ 'id': 'renew' });
		constraints.setCompositeOptions(compositeOptions);
		sendStream({}, 'composite');
	}

    //No user media
	$scope.watchOnly = function() {
		renewConstraints('watchOnly');
	};

    //Only user micro
	$scope.microOnly = function() {
		renewConstraints('audioOnly');
	};

    //User webcam and micro
	$scope.allTracks = function() {
		renewConstraints('normal');
	};

    /**
    * End of media selection bloc
    */
    
    /**
    * Start of the flow bloc
    */
    
	function receiveVideo(userId, sender, isScreensharer) {

		if (participants.get(userId) === undefined)
			participants.add(userId, sender);

		if (isScreensharer) {
			progress.circular.show('#2196F3', '#progress');
			$scope.presentation.disabled.all();
		}

		var participant = participants.get(userId);

		var type = (!isScreensharer) ? 'composite' : 'presentation';

		var options = {
			remoteVideo: document.getElementById(type),
			onicecandidate: participant.onIceCandidate[type].bind(participant)
		};

		participant.rtcPeer[type] = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options,
			function(error) {
				if (error) {
					return console.error(error);
				}
                
				this.generateOffer(participant.offerToReceive[type].bind(participant));
			});
	}
    
    
	function sendStream(message, type) {
		var emptyTrack = false;
		var c = constraints.get();

		if (!c.audio && !c.video) {
			c.audio = true;
			emptyTrack = true;
		}

		var participant = participants.me();

		var options = {
			mediaConstraints: c,
			onicecandidate: participant.onIceCandidate[type].bind(participant)
		};

		if (message.lineExtension)
			setLineExtension(message.lineExtension);

		if (type == 'composite') {
			if (!_.isEmpty(message)) {
				$scope.participantNames = message.data;
				$scope.participantNames.push(participant.name);
				updateScope();
			}
			options.remoteVideo = document.getElementById(type);
		} else {
			options.localVideo = document.getElementById(type);
			$scope.presentation.disabled[constraints.getType()] = true;
		}
         
        //participant.rtcPeer[type] = new kurentoUtils.WebRtcPeer.WebRtcPeerSendonly
		participant.rtcPeer[type] = new kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options,
			function(error) {
				if (error)
					$scope.presentation.presenterIsMe = false;

				if (constraints.browserIsFirefox && error && type != 'composite') {

					var warning = {
						title: 'Firefox needs to be configured (about:config)',
						content: 'Set media.getusermedia.screensharing.enabled to true and add our address to media.getusermedia.screensharing.allowed_domains'
					};

					notifications.alert(warning.title, warning.content, 'Ok', function(answer) {
						// This should be handled by lumx (it must be a bug)
						// May be removed in the future
						$('.dialog-filter').remove();
						$('.dialog').remove();
					});
				}

				if (emptyTrack) {
					var tracks = this.getLocalStream().getTracks();
					tracks.forEach(function(e) {
						e.stop();
					});
				}
                
                //this.generateOffer
				this.generateOffer(participant.offerToReceive[type].bind(participant));
			});

		if (message.existingScreensharer && type == 'composite') {
			enablePresentationClass();

			if (message.presenterId != participants.me().userId) {
				receiveVideo(message.presenterId, message.screensharer, true);
			}
		}

	}
    
    /**
    * End of the flow bloc
    */
    
    //Function used at the beggining of a presentation
	function onPresenterReady(message) {

		enablePresentationClass();
		if (message.userId != participants.me().userId) {
			receiveVideo(message.userId, message.presenter, true);
		}
	}

    //Function used at the end of a presentation
	function cancelPresentation(message) {

		console.log("Cancelling Presentation");

		disablePresentationClass();

		if (message.userId != participants.me().userId) {
			if (participants.get(message.userId) !== undefined)
				participants.get(message.userId).rtcPeer['presentation'].dispose();
		}
	}
    
    //Update participant list and print a message when someone join the room
	function onNewParticipant(request) {

		participants.add(request.userId, request.name);
		$scope.participantNames.push(request.name);
		updateScope();
        
        if ($rootScope.langKey === 'en') {
		  notifications.notify(request.name + ' has joined the room !', 'account-plus');
        } else if ($rootScope.langKey === 'fr') {
          notifications.notify(request.name + ' a rejoins la salle !', 'account-plus');    
        }
		console.log(request.name + " has just arrived ! Welcome him !");

	}
    
    //Inform all users that a record has begin
    function recordJava (request) {
        if (!(request.userJava === participants.me().userId)) {
            $scope.record.update();
            if ($rootScope.langKey === 'en') {
            notifications.notify("A record of room " + request.roomJava + " has been started by " + request.nameJava + " who have ID " + request.userJava, 'account-plus');
            } else if ($rootScope.langKey === 'fr') {
            notifications.notify("Un enregistrement de la salle " + request.roomJava + " a été démarré par " + request.nameJava + " qui a l'ID " + request.userJava, 'account-plus');    
            }
        } else {
            if ($rootScope.langKey === 'en') {
            notifications.notify("You started a recording", 'account-plus');
            } else if ($rootScope.langKey === 'fr') {
            notifications.notify("Vous avez démarré l'enregistrement", 'account-plus');     
            }
        }
    }

    //Inform all users that a record has been closed
    function stopRecordJava (request) {
        if (!(request.userJava === participants.me().userId)) {
            $scope.record.update();
            if ($rootScope.langKey === 'en') {
            notifications.notify("A record of room " + request.roomJava + " has been cancelled by " + request.nameJava + " who have ID " + request.userJava, 'account-plus');
            } else if ($rootScope.langKey === 'fr') {
            notifications.notify("Un enregistrement de la salle " + request.roomJava + " a été terminé " + request.nameJava + " qui a l'ID " + request.userJava, 'account-plus');    
            }
        } else {
            if ($rootScope.langKey === 'en') {
            notifications.notify("You stopped a recording", 'account-plus');
            } else if ($rootScope.langKey === 'fr') {
            notifications.notify("Vous avez arrété l'enregistrement", 'account-plus');     
            }
        }
    }

    //Update participant list and print a message when someone leave the room
	function onParticipantLeft(request) {

		console.log('Participant ' + request.name + ' left');
		var participant = participants.get(request.userId);

		if (request.isScreensharer) {
			disablePresentationClass();
		}

		if (participant !== undefined)
			participant.dispose();

		participants.remove(request.userId);

        if ($rootScope.langKey === 'en') {
		notifications.notify(request.name + ' has left the room', 'account-remove');
        } else if ($rootScope.langKey === 'fr')  {
        notifications.notify(request.name + ' a quitté la salle', 'account-remove');    
        }

		$scope.participantNames = request.data;
		updateScope();
	}

    //Analyze the result of the video demand
	function receiveVideoResponse(result) {

		participants.get(result.userId).rtcPeer[result.type].processAnswer(result.sdpAnswer, function(error) {
			if (error) return console.error(error);
		});
	}

    //WORK FOR SIP MERGING : This function has already been re-write with the use of of scope variable, much better than old git one
	function setLineExtension(extension) {
		$scope.lineExtension = extension;
		$scope.lineAvailable = true;
		$('.search-to-phone input').attr('type', 'tel');
		updateScope();
	}

	/**
    * Start of the CSS bloc.
    */
	angular.element(document).ready(function () {
		adaptCompositeContainer();

		$(window).resize(function() {
			adaptCompositeContainer();
		});

		$('video').resize(function() {
			adaptCompositeContainer();
		}).on('play', function() {
			$(this).addClass('playing');
		});

		$('#presentation').on('play', function() {
			$(this).addClass('playing');
			progress.circular.hide();
		});
	});

	function adaptCompositeContainer() {
		$('video').css('max-height', $(window).height() - 30 + 'px');
	}

	function enablePresentationClass() {
		$scope.presentation.active = true;
		setWidth('.video-room', null, 'hasPresentation', ['noPresentation']);
	}

	function disablePresentationClass() {
		setWidth('.video-room', null, 'noPresentation', ['hasPresentation', 'bigger', 'smaller']);
		$('#presentation').removeClass('playing');
		$scope.presentation.active = false;
		$scope.presentation.disabled.none();
	}

	function setWidth(elt1, elt2, elt1Class, elt2Classes) {
		if ($scope.presentation.active) {
			$(elt1).animate({
				opacity: 1
			}, {
				duration: 500,
				start: function() {
					for (var k in elt2Classes) {
						$(elt1).removeClass(elt2Classes[k]);
					}

					$(elt1).addClass(elt1Class);
				},
				progress: adaptCompositeContainer
			});

			$(elt2).removeClass(elt1Class);

			for (var k in elt2Classes)
				$(elt2).addClass(elt2Classes[k]);
		}
	}

	var sizeBig = {
		composite: false,
		presentation: false
	};

	function setBigs(isCompositeBig, isPresentationBig) {
		sizeBig['composite'] = isCompositeBig;
		sizeBig['presentation'] = isPresentationBig;
	}

	$scope.clicked = {
		composite: false,
		presentation: false
	};

	$scope.cancelClick = {
		composite: false,
		presentation: false
	};

	function clickHandler(id, callback_oneClick, callback_twoClicks) {
		if ($scope.clicked[id]) {
			$scope.cancelClick[id] = true;
			callback_twoClicks();
			return;
		}

		$scope.clicked[id] = true;

		$timeout(function() {
			if ($scope.cancelClick[id]) {
				$scope.cancelClick[id] = false;
				$scope.clicked[id] = false;
				return;
			}

			callback_oneClick();

			$scope.cancelClick[id] = false;
			$scope.clicked[id] = false;

		}, 400);
	}

	function setFullScreen(id) {
		var elem = document.getElementById(id);
		if (elem.requestFullscreen)
			elem.requestFullscreen();
		else if (elem.mozRequestFullScreen)
			elem.mozRequestFullScreen();
		else if (elem.webkitRequestFullscreen)
			elem.webkitRequestFullscreen();
	}

	function setCompositeFullScreen() {
		setFullScreen('composite');
	}

	function setPresentationFullScreen() {
		setFullScreen('presentation');
	}

	function changeCompositeSize() {
		if (!sizeBig['composite']) {
			setWidth('#composite-container', '#presentation-container', 'bigger', ['smaller']);
			setBigs(true, false);
		} else {
			setWidth('#composite-container', null, null, ['bigger']);
			setWidth('#presentation-container', null, null, ['smaller']);
			setBigs(false, false);
		}
	}

	function changePresentationSize() {
		if (!sizeBig['presentation']) {
			setWidth('#composite-container', '#presentation-container', 'smaller', ['bigger']);
			setBigs(false, true);
		}  else {
			setWidth('#presentation-container', null, null, ['bigger']);
			setWidth('#composite-container', null, null, ['smaller']);
			setBigs(false, false);
		}
	}

	$scope.compositeVideoClick = function() {
		clickHandler('composite', changeCompositeSize, setCompositeFullScreen);
	};

	$scope.presentationVideoClick = function() {
		clickHandler('presentation', changePresentationSize, setPresentationFullScreen);
	};

    $scope.setOutputVideoResolution = function (mode) {
        if (mode === "test") {
        $('#composite-container').css('max-width', '640px');
        console.log('640px');
        } else if (mode === "normal") {
        $('#composite-container').css('max-width', '800px');
        console.log('60%');
        } else if (mode === "cinema") {
        $('#composite-container').css('max-width', '1280px');
        console.log('90%');    
        }
    };
    
	$scope.toggleSidebar = function() {
		var matrix = $('.sidebar').css('transform');
		if (matrix != 'none') {
			var translation = matrix.match(/-?[\d\.]+/g)[4];
			if (translation == "0") {
				translateSidebar(-266);
			} else if (translation == "-266") {
				translateSidebar(0);
			}
		}
	};

	function translateSidebar(value) {
		$('.sidebar').css({
			'-webkit-transform' : 'translate(' + value + 'px)',
			'-ms-transform' : 'translate(' + value + 'px)',
			'-moz-transform' : 'translate(' + value + 'px)',
			'transform' : 'translate(' + value + 'px)'
		});
	}

	// Volume part
	$scope.volume = {
		muted: false,
		icon: 'mdi-volume-high',
		text: 'MUTE',
		change: function() {
			this.muted = !this.muted;
			this.text = (this.muted) ? 'UNMUTE' : 'MUTE';
			this.icon = (this.muted) ? 'mdi-volume-off' : 'mdi-volume-high';
			$('#composite').prop('muted', this.muted);
			updateScope();
		}
	};

	$scope.dropdownDropped = false;
    $scope.toggleDropdown = function() {
		var dropdownElt = $('.dropdown-menu');
		if ($scope.dropdownDropped) {
			dropdownElt.animate({
				'opacity': 0,
				'top': '40px',
				'right': '16px'
			}, 200);

			setTimeout(function() {
				dropdownElt.css('display', 'none');
			}, 200);
			$(document).off('click');
		} else {
			dropdownElt.css('display', 'block');
			dropdownElt.animate({
				'opacity': 1,
				'top': '52px',
				'right': '16px'
			}, 200);

			$(document).click(function(event) {
                
				if ($(event.target).closest('.dropdown-menu').length != 0)
					return false;
                
                if (constraints.browserIsFirefox) {
                    
                    if ($(event.target).attr('class') === 'btn btn--l btn--white btn--icon') {
					return false;
                    }
                }
                
				if ($(event.target).closest('.mdi-dots-vertical').length != 0)
					return false;

				$scope.toggleDropdown();
			});
		}

		$scope.dropdownDropped = !$scope.dropdownDropped;

	};


	function updateScope() {
		_.defer(function() {
			$scope.$apply();
		});
	}
    /**
    *End of the CSS bloc
    */
}

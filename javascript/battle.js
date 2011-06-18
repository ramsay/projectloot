/*
 Copyright 2007 Google Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
/**
 * Javascript code specific to the battle page.
 *
 * The battle page is fairly complex, with a number of different, asynchronously
 * updating elements, controlled by a few different state variables.
 *
 * The Board:
 *
 * The board is basically an array of piece data. When we get a refresh from the
 * server, we calculate the new board state by starting with a fresh board and
 * applying the list of moves.
 *
 * The board is rendered as a series of divs, which are given class names to
 * cause them to render themselves appropriately based on the associated piece.
 * Every square on the board has its own DIV, and we intercept clicks on these
 * DIVs to process move input from the user. Input is ignored unless
 * canMove=true, which is set based on the battle state (whose turn is it, has
 * the user already made his move, is the battle over already?)
 *
 * Chat:
 *
 * The chat pane is only visible if the user is a participant in the battle. It
 * has its own timer which fires off every 5 seconds.
 *
 * Game updates:
 *
 * We periodically poll the server for battle status updates when it is not the
 * user's turn. For an untimed battle, we update every 60 seconds, as a timely
 * update is not as important. For a timed battle, we update every 3 seconds.
 *
 * Additionally, for timed games, we send an update to the server every 3
 * seconds when it is the user's turn, so the other player's display can be
 * updated with the current elapsed time.
 *
 * Endgame
 *
 * The battle ends in checkmate, if a user resigns, or if one side runs out of
 * time. When one of these states are reached, we notify the server. For
 * the fast user feedback, we track things like elapsed time, resignation and
 * checkmate on the client, but in a production system we would want to
 * double-check these on the server to avoid cheating (for example, a client
 * failing to report running out of time, or incorrectly declaring checkmate)
 */
$(document).ready(function() {

    // Start refreshing the page as soon as we are loaded
    battle.refreshBoard();

    // Corner-ify items
    $('.timeDisplay').corner({autoPad:true, validTags:["div"]});
    $('.waitingForOpponent').corner({autoPad:true, validTags:["div"]});
    $('.yourTurn').corner({autoPad:true, validTags:["div"]});

    // TODO: Set onbeforeunload() handler to catch when user navigates away
    // so we can warn the user first if he has a battle in progress
});

var battle;
battle = {
    // The constants that match each piece color
    WHITE: 0,
    BLACK: 1,

    // The constants that match the battle states (active/complete)
    ACTIVE:2,
    COMPLETE:3,

    // The index of the last chat item we have displayed - this is updated
    // as chats are sent from the server.
    chatId: 0,

    // Set to true once we've initialized the chat area
    chatInitialized: false,

    // The list of moves that were sent from the server
    moveList: [],
    taskList: [],

    // The total time limit for this battle (5 = 5 mins, 10 = 10 mins,
    // null = untimed)
    timeLimit: null,

    // How much time is left for each player
    whiteTime: null,
    blackTime: null,

    // How often we redraw the timers, in milliseconds
    TIMER_UPDATE_INTERVAL: 200,

    // Whose turn it is (WHITE = 0, BLACK = 1) or null if the battle is over
    whoseTurn: null,

    // The color of the currently logged in user (WHITE=0, BLACK=1, or null if
    // the user is a spectator (not a participant)
    color: null,

    // The status of the battle (active or complete)
    status: null,

    // The victor (if status == COMPLETE, then 0=draw, 1 = creator won, 2 =
    // opponent won)
    victor: null,

    // If true, the user can make a move (it's his turn, and he hasn't made his
    // move yet)
    canMove: false,

    // The timestamp of when the user started his move, otherwise null (if it's
    // not his move or he isn't a participant)
    moveStart: null,

    // The timer we use to trigger an update from the server for the battle state
    refreshGameTimer: null,

    // The timer we use to trigger an update of the chat window
    refreshChatTimer: null,

    // This is a hack - when the user does a pawn promotion, we need to save
    // off the pending move to give him a chance to select what piece he wants
    // before sending it to the server, so we put it here.
    pendingMove: null,

    refreshBoard: function() {
        // hit the ajax handler to load our battle data
        var options = {
            url: "/dex_ajax/move/" + battle.gameKey + "/" + battle.moveList.length,
            dataType: "json",
            // Avoid caching of HTTP GETs by appending a random param
            data: {z: new Date().getTime()},
            error: blitz.retryOnFail,
            success: battle.updateBattleDisplay
        };
        $.ajax(options);
    },

    // Handle a battle update from the server - update our battle state, then
    // update the ui.
    updateBattleDisplay: function(data) {
        $(".busy").hide();
        battle.moveList = battle.moveList.concat(data.move_list);
        battle.taskList = battle.taskList.concat(data.task_list);
        battle.teams = data.teams;
        battle.status = data.status;
        battle.victor = data.victor;
        battle.creator_color = data.creator_color;

        // Figure out what color the player is, based on the "is_creator" flag
        // and the creator_color value.
        if (data.is_participant) {
            battle.color = data.is_creator ? data.creator_color : 1 - data.creator_color;
        }

        // Update our time variables
        battle.whiteTime = data.creator_color == battle.WHITE ?
            data.player1_time : data.player2_time
        battle.blackTime = data.creator_color == battle.BLACK ?
            data.player1_time : data.player2_time
        battle.timeLimit = data.time_limit;

        // Get the player names
        battle.whiteName = data.creator_color == battle.WHITE ?
            data.creator : data.opponent;
        battle.blackName = data.creator_color == battle.BLACK ?
            data.creator : data.opponent;

        // Only participants get to see the chat
        if (data.is_participant) {
            battle.initChat();
        }

        // Update the board with the latest moves
        battle.updateBoard();

        // Update the header with time elapsed, etc - also refreshes our internal
        // variables
        battle.updateHeader();

        // If it's still not our turn, kick off the refresh timer to check for
        // updates from the server
        if (battle.status == battle.ACTIVE) {
            if (battle.canMove) {
                // It's the user's turn - if there's a time limit, we should set a
                // timer to update the server periodically with the updated time.
                if (battle.timeLimit) {
                    battle.refreshGameTimer =
                        window.setTimeout(battle.sendTimeToServer, 5 * 1000);
                }
            } else {
                // If the user is playing blitz, then check every 3 secs to keep the
                // battle moving along quickly. Otherwise, check at a leisurely
                // once-per-minute pace.
                var refreshInterval = battle.timeLimit ? 3 * 1000 : 60 * 1000;
                battle.refreshGameTimer =
                    window.setTimeout(battle.refreshBoard, refreshInterval);
            }
        }
    },



    // returns the last move that was sent
    getLastMove: function() {
        if (battle.moveList.length == 0) {
            return "";
        } else {
            return battle.moveList[battle.moveList.length - 1];
        }
    },

    // Renders the board based on the latest move list
    updateBoard: function() {
        // Figure out our current board situation (caps = white)
        // (first char is lower left corner of board)
        battle.dex = new Dex();
        battle.renderBoard();
    },

    renderBoard: function() {
        // Remove all characters
        $('.battleBoard .character').remove();

        var lastMove = battle.dex.getLastMove();

        // Walk our battle board and place pieces appropriately
        var teams = [battle.teams.black, battle.teams.white];
        for (var i = 0; i < teams.length; i++) {
            for (var j = 0; j < teams[i].roster.length; j++) {
                var x = i * 7;
                var y = j * 2;
                var pos = {pos: "" + (x + 1) + (y + 1)};

                // We have a bunch of class names (x0-x7 and y0-y7) to match each of
                // the X/Y coords, which position the piece appropriately
                var posClass = {posClass: "x" + x + " y" + y};

                // We use a different image set for IE6 (as it doesn't support the alpha
                // channel on PNG files) - detect IE6 and set the appropriate class.
                // This is kind of a moot point as we don't really support IE6 anyway.
                var isIe6 = jQuery.browser.msie &&
                    (parseFloat(jQuery.browser.version) < 7);
                var ie6Class = isIe6 ? "ie " : "";

                // Clone our template piece, adding the appropriate class name to
                // it to force the position, and setting a "pos" and "posClass"
                // attribute which we use to track the class and "real" position for
                // use when moving items around in handleClick()
                $(".templates " + teams[i].roster[j].img_class).clone()
                    .addClass(posClass.posClass + ie6Class)
                    .attr(pos)
                    .attr(posClass)
                    .appendTo(".battleBoard");
            }
        }

        // Let's render the captured state too (TODO)

        // Make the pieces clickable (the click handler decides whether to ignore
        // clicks or not)
        $(".battleBoard .piece").click(battle.handleClick);
    },

    handleClick: function() {
        // Our click handler - ignore clicks if we can't move
        if (battle.canMove) {
            var colorClass = battle.color == battle.WHITE ? "white" : "black";
            if ($(this).hasClass("selected")) {
                // Remove selection if we click on the same piece twice
                $(this).removeClass("selected");
            } else if ($(this).hasClass(colorClass)) {
                // If this is one of our own pieces, move selection here
                $(".piece").removeClass("selected");
                $(this).addClass("selected");
            } else if ($(".selected").size() > 0) {
                // There is a selection, and we are moving to either a blank row or
                // an opponent's piece, so see if the move is valid
                var oldPos = $(".selected").attr("pos");
                var newPos = $(this).attr("pos");
                if (!battle.dex.validMove(oldPos + "-" + newPos)) {
                    // Flash this as invalid for 1/4 second
                    $(this).addClass("invalidMove");
                    window.setTimeout(battle.removeInvalid, 250);
                    return;
                }

                //
                // Move is valid, so move the piece there by swapping out the
                // position CSS classes
                var oldClass = $(".selected").attr("posClass");
                var newClass = $(this).attr("posClass");
                var piece = battle.dex.getPiece(Dex.toIndex(oldPos));
                if (piece.toLowerCase() == 'p') {
                    // Moving a pawn - are we moving it to the promote row?
                    if (newPos.charAt(1) == '1' || newPos.charAt(1) == '8') {
                        blitz.initAndDisplayDialog('#promoteDialog');
                        // Save the pending move for when the user returns
                        battle.pendingMove = oldPos + "-" + newPos;
                        return;
                    }
                }
                $(this).remove();
                $(".selected").removeClass(oldClass).addClass(newClass);
                // OK, we've moved, and we can't move again until we get an update
                battle.sendMoveToServer(oldPos + "-" + newPos);
            }
        }
    },

    // Called via a timer to remove the "invalid move" highlight
    removeInvalid: function() {
        $('.invalidMove').removeClass("invalidMove");
    },

    doPromote: function() {
        var result = $("input[@name=promote]:checked").val();
        $.modal.close();
        battle.sendMoveToServer(battle.pendingMove + "-" + result);
    },

    // Tell the server about our latest move
    sendMoveToServer: function(move) {
        // We're sending a move to the server, so our turn is over
        battle.canMove = false;
        var data = {};
        if (move) {
            if (move.charAt(0) >= '0' && move.charAt(0) <= '9') {
                // It's a real move - let's see if it's a checkmate
                battle.dex.addMove(move);
                // If it's a checkmate, mark it so
                if (battle.dex.checkmate(1 - battle.color)) {
                    move = '#' + move;
                }
            }
            data.move = move;
        }

        // Send up a time update
        if (battle.timeLimit && battle.moveStart) {
            if (battle.color == battle.WHITE) {
                battle.whiteTime -= battle.elapsedTime();
                data.time = battle.whiteTime;
            } else {
                battle.blackTime -= battle.elapsedTime();
                data.time = battle.blackTime;
            }
            data.time = Math.max(data.time, 0);
            // Blow away the elapsed time
            delete battle.moveStart;
        }

        // We're sending our move to the server - stop updating the board. When
        // this comes back, we'll refresh the board which will kick off a new
        // timer.
        window.clearTimeout(battle.refreshGameTimer);
        delete battle.refreshGameTimer;
        $(".busy").show();
        options = {
            url: "/dex_ajax/" + battle.gameKey + (move ? "/move" : "/time"),
            data: data,
            type: "POST",
            error: battle.refreshBoard,
            success: battle.refreshBoard
        };
        $.ajax(options);
    },

    // Update our timestamp on the server - this is called by a timer periodically
    sendTimeToServer: function() {
        if (battle.color == battle.WHITE) {
            var time = Math.max(0, battle.whiteTime - battle.elapsedTime());
        } else {
            var time = Math.max(0, battle.blackTime - battle.elapsedTime());
        }

        options = {
            url: "/dex_ajax/" + battle.gameKey + "/time",
            data: {time: time},
            type: "POST"
            // Ignore errors and success - this is just a non-critical attempt to
            // keep the server in-sync
        };
        $.ajax(options);

        // Fire off the next timer
        battle.refreshGameTimer = window.setTimeout(battle.sendTimeToServer, 5 * 1000);
    },

    updateHeader: function() {
        // Updates the header display when changes happen (battle ends, etc)
        battle.updateStatusDisplay();

        // Figure out if we can move
        if (battle.color != null && battle.status == battle.ACTIVE) {
            if (battle.whoseTurn == battle.color) {
                // This is this user's turn - tell them
                if (!battle.canMove) {
                    // It's now our turn (it wasn't before) so start the timer
                    battle.canMove = true;
                    // Mark what time our move started
                    battle.moveStart = new Date().getTime();
                }
            } else {
                // Not our turn - stop tracking our start time (checked below in
                // updateTime())
                delete battle.moveStart;
            }
        } else {
            battle.canMove = false;
        }

        // Render the header - this involves updating the timer (if necessary)
        // and making sure the colors are in the right places
        if (battle.color == battle.BLACK) {
            // We're drawing the black pieces at the bottom, so make sure it's there
            // already, otherwise we have to swap.
            $('.statusTop .blackHeader')
                .replaceWith($('.statusBottom .whiteHeader'))
                .appendTo('.statusBottom');
        }

        $('#whitePlayer').text(battle.whiteName);
        $('#blackPlayer').text(battle.blackName);

        $('.title').hide();
        $('.statusTop').show();
        $('.statusBottom').show();

        if (battle.timeLimit) {
            battle.updateTime();
        }
    },

    updateStatusDisplay: function() {
        // Update the various turn indicators
        if (battle.status != battle.ACTIVE) {
            // Game is over, hide everything, show end battle display
            $('#blackIndicator').hide();
            $('#whiteIndicator').hide();
            $('.yourTurn').hide();
            $('.waitingForOpponent').hide();

            // Figure out why the battle ended - either through resignation, a draw,
            // a timeout, or checkmate
            if (battle.victor == 0) {
                var result = "Game ended in a draw";
            } else {
                if (battle.victor == 1) {
                    var winningColor = battle.creator_color;
                } else {
                    var winningColor = 1 - battle.creator_color;
                }

                if (battle.color != null) {
                    // Participant is viewing
                    var result = (winningColor == battle.color) ?
                        "You win!" : "You lost!"
                } else {
                    // Spectator is viewing
                    var result = (winningColor == battle.WHITE) ?
                        "White wins!" : "Black wins!";
                }

                if (battle.getLastMove() == "resign") {
                    result += " (" +
                        (winningColor == battle.WHITE ? "black" : "white") +
                        " resigned)";
                } else if (battle.timeLimit &&
                    (battle.whiteTime == 0 || battle.blackTime == 0)) {
                    result += " (time expired)";
                }
            }
            $('.gameOver').text(result);
            $('.gameOver').corner({autoPad:true, validTags:["div"]});
            $('.gameOver').show();

        } else {
            if (battle.whoseTurn == battle.WHITE) {
                $('#blackIndicator').hide();
                $('#whiteIndicator').show();
            } else {
                $('#blackIndicator').show();
                $('#whiteIndicator').hide();
            }
            if (battle.color != null) {
                if (battle.whoseTurn != battle.color) {
                    $('.waitingForOpponent').show();
                    $('.yourTurn').hide();
                } else {
                    $('.waitingForOpponent').hide();
                    $('.yourTurn').show();
                }
            }
        }
    },

    elapsedTime: function() {
        // Returns the elapsed time from the start of the player's move
        return new Date().getTime() - battle.moveStart;
    },

    updateTime: function() {
        // Updates the time display - calculate the time, and if it's the user's
        // turn to move then also incorporate the time delta
        var whiteTime = battle.whiteTime;
        var blackTime = battle.blackTime;
        if (battle.moveStart) {
            if (battle.color == battle.WHITE) {
                whiteTime -= battle.elapsedTime();
            } else if (battle.color == battle.BLACK) {
                blackTime -= battle.elapsedTime();
            }

            if (whiteTime < 0 || blackTime < 0) {
                battle.outOfTime();
            }
        }
        battle.setTime('#whiteTime', Math.max(whiteTime, 0));
        battle.setTime('#blackTime', Math.max(blackTime, 0));

        if (battle.moveStart) {
            // Only need to update the time again if the user has a move timer
            timeDisplayTimer = window.setTimeout(battle.updateTime,
                battle.TIMER_UPDATE_INTERVAL);
        }
    },

    outOfTime: function() {
        // Called when the user runs out of time
        // Disable any moves, and send the time update to the server
        battle.sendMoveToServer();

        // Just wait for the response to come back - this will automatically cause
        // the end battle to be reflected on the screen
    },

    resign: function() {
        battle.sendMoveToServer("resign");
    },

    setTime: function(element, timeRemaining) {
        // Format the time remaining in MM:SS format (or, conversely, in SS.T)
        // format where T = tenths of seconds)
        if (timeRemaining >= 60 * 1000) {
            // > 1 minute
            var minutes = Math.floor(timeRemaining / 60000);
            var seconds = Math.floor(timeRemaining / 1000) % 60;
            var timeStr = "" + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
        } else {
            var tenths = Math.floor(timeRemaining / 100);
            var timeStr = "" + Math.floor(tenths / 10) + "." + (tenths % 10);
        }
        $(element).text(timeStr);
        $(".timeDisplay").show();
        if (timeRemaining < 30000) {
            // Highlight the time if there's < 30 secs
            $(element).addClass("critical")
        }
    },

    resignGame: function() {
        if (battle.canMove) {
            if (confirm("Are you sure you want to resign?")) {
                // Make sure the user can still move - events may have been processed
                // while we were blocked on the dialog
                if (battle.canMove) {
                    battle.sendMoveToServer("resign");
                }
            }
        }
    },

    offerDraw: function() {
        if (battle.canMove) {
            if (confirm("Are you sure you want to offer to end this battle in a draw?")) {
                // Make sure the user can still move - events may have been processed
                // while we were blocked on the dialog
                if (battle.canMove) {
                    battle.sendMoveToServer('offerDraw');
                }
            }
        }
    },

    acceptDraw: function() {
        if (battle.canMove) {
            battle.sendMoveToServer('draw')
        }
        $.modal.close();
    },

    rejectDraw: function() {
        if (battle.canMove) {
            battle.sendMoveToServer('reject')
        }
        $.modal.close();
    },

    //----------------------------------------
    // Chat handling code
    initChat: function() {
        if (!battle.chatInitialized) {
            battle.chatInitialized = true;

            // Make sure chat is visible
            $('.chatGroup').show();

            // Initialize the chat text input to send contents when enter pressed
            $("#chatInput").keypress(function(e) {
                if (e.keyCode == 13) {
                    battle.sendChat();
                }
            });

            // Kick off the chat timer/refresh
            battle.refreshChat();
        }
    },

    forceRefreshChat: function() {
        if (battle.refreshChatTimer) {
            // If a timer exists, then force a refresh (if a timer exists, it means
            // that there isn't a refresh in process)
            battle.refreshChat();
        }
    },

    refreshChat: function() {
        // Stop any existing timer (so if we're called from forceRefreshChat() we
        // won't get dual timers running
        if (battle.refreshChatTimer) {
            window.clearTimeout(battle.refreshChatTimer);
            delete battle.refreshChatTimer;
        }

        var options = {
            url: "/dex_ajax/chat/" + battle.gameKey + "/" + battle.chatId,
            dataType: "json",
            // Avoid caching of HTTP GETs
            data: {z: new Date().getTime()},
            error: blitz.retryOnFail,
            success: battle.handleChatResponse
        };
        $.ajax(options);
    },

    sendChat: function() {
        // Grab the string the user entered and send it to the server
        var data = $("#chatInput").val();
        data = jQuery.trim(data);
        if (data.length > 0) {
            $("#chatInput").val("");
            var options = {
                url: "/dex_ajax/" + battle.gameKey + "/chat",
                data: {chat: data},
                type: "POST",
                error: blitz.retryOnFail,
                success: battle.forceRefreshChat
            };
            $.ajax(options);
        }
    },

    handleChatResponse: function(data) {
        // Got a response from the server - update our chat and fire off another
        // refresh in 5 secs.
        battle.chatId = data.msg_id;
        chat.updateChat(data.data);
        battle.refreshChatTimer = window.setTimeout(battle.refreshChat, 5 * 1000);
    },

    addMove: function(char, move) {
        var valid = battle.dex.addMove(this.color, char, move);
        if (valid) {
            char += 1;
            // Move was successfully added update battle menu for next character.
            teams = [this.teams.black, this.teams.white];
            if (char >= teams[this.color].roster.length) {
                alert("Last Move! Submit?");
            } else {
                var nextChar = teams[this.color].roster[char];
                var label = $('.battleMenu h4');
                label.html(nextChar.name);
                $('.battleMenu .character').remove();
                $('.battleMenu ul').before(
                    "<div class='character "
                        + nextChar.img_class.substring(1)
                        + "'></div>"
                );
                $(".battleMenu li").remove();
                $(".battleMenu ul").append("<a href='#attack'>" +
                    "<li onclick='battle.addMove(" + char + ", &quot;attack&quot;)'>1:Attack</li></a>" +
                    "<li onclick='battle.addMove(" + char + ", &quot;ability&quot;)'>2:Ability</li></a>" +
                    "<li onclick='battle.addMove(" + char + ", &quot;defend&quot;)'>3:Defend</li></a>");
            }
        } else {
            alert("invalid move!");
        }
    }
};


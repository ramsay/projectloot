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
 * dex.js
 *
 * This file contains an implementation of a chessboard, with a move validator,
 * tracking of captured pieces, and checkmate detection.
 *
 * Typical use of this object might be:
 *
 * var dex = new Dex();  // Initialize a Dex object with the default board
 * if (!dex.validMove(moveStr)) {
 *   ...handle invalid move...
 * } else {
 *   dex.addMove(moveStr);
 *   if (dex.is_checkmate()) {
 *     ...handle checkmate...
 *   } else {
 *     var board = dex.getBoard();
 *        ... render board ...
 *     var capturedPieceArray = dex.getCapturedPieces()
 *        ... render captured pieces ...
 *   }
 * }
 *
 * The "moveStr" is a string in ICCF format, where positions are given
 * numerically starting at 11 in the lower left corner (White Queen's Rook)
 * and going to 88 in the upper right corner (Black King's Rook).
 *
 * http://en.wikipedia.org/wiki/ICCF_Notation
 *
 * Accepted formats are (f=From position, t=To position):
 *
 * ff-tt   (example: 12-14 moves the leftmost white pawn two ranks forward)
 * ff-tt-p (same as ff-tt, except p denotes a pawn promotion: 1=Queen, 2=Rook,
 *          3=Bishop, 4=Knight)
 * #ff-tt    (same as ff-tt, except # denotes "checkmate")
 * #ff-tt-p  (same as ff-tt-p, except # denotes "checkmate")
 *
 * Castling is denoted by a king move (the corresponding rook move is implied
 * by the king moving two squares to the left/right)
 */


/**
 * Creates a new Dex object given the optional starting board.
 *
 * @param opt_startingBoard Array of strings containing a board state - 64
 * characters, one per board square, going from 11, 21, 31, 41... up to 88.
 *
 */
function Dex(opt_startingTeams) {
  this.teams = opt_startingTeams;
  if (!this.teams) {
    // No board was provided, so use a default board. Capital letters denote
    // white pieces
    this.teams = Dex.DEFAULT_TEAMS;
  }
  // List of moves that have been added to this board by addMove() - this is
  // needed because some moves (like en passant and castling) require that we
  // have access to the move history to check validity.
  this.moveList = [];
  for (var team in Object.keys(this.teams)) {
      this.moveList[this.moveList.length] = new Object();
  }
  // List of pieces that have been captured (not sorted in any particular order)
  this.captureList = [];
};

Dex.prototype = {};

// The default, fallback dex teams.
Dex.DEFAULT_TEAMS = {
    black: {
        health: 10,
        magic: 4,
        defense: 0,
        roster: [
            {
                name: 'Fighter',
                strength: 2,
                agility: 3,
                defense: 1,
                ability : { name: 'Roar',
                            cost: 0,
                            description: 'Strike fear in the hears of foes'},
            },
            {   name: 'Mage',
                strength: 1,
                agility: 5,
                defense: 1,
                ability : { name: 'Heal',
                            cost: 2,
                            description: 'use primitive medical skills'}
            }
        ]
    },
    white: {
        health: 10,
        magic: 4,
        defense: 0,
        roster: [
            {
                name: 'Fighter',
                strength: 2,
                agility: 3,
                defense: 1,
                ability : { name: 'Roar',
                            cost: 0,
                            description: 'Strike fear in the hears of foes'},
            },
            {   name: 'Mage',
                strength: 1,
                agility: 5,
                defense: 1,
                ability : { name: 'Heal',
                            cost: 2,
                            description: 'use primiteve medical skills'}
            }
        ]
    }
};

// Constants when we need
Dex.WHITE = 0;
Dex.BLACK = 1;

/**
 * Checks to see if the proposed move is valid
 * @param moveStr The move in ICCF format (see file header)
 * @return true if the move is valid, else false
 */
Dex.prototype.validMove = function(moveStr) {
  // Make sure the move is generally valid - that it's the appropriate
  // color's turn, and that the move does not move one color on top of another
  // piece of the same color.
  var move = Dex.parseMove(moveStr);
  return this.validParsedMove(move);
}

/**
 * Same as validMove, but takes a parsed move.
 * @param move move object, with to/from integer properties
 * @param opt_skip_turn_check if True, skips the turn check (useful when
 *   checking for Check/Checkmate)
 * @param opt_skip_check_check if True, skips the check for being in check
 *   used when checking for being in check, as you can still put your opponent
 *   in check with a piece even if technically you can't move that piece
 *   because it is blocking your own king from being in check)
 */
  Dex.prototype.validParsedMove = function(move, opt_skip_turn_check,
                                             opt_skip_check_check) {
  var piece = this.getPiece(move.from);
  if (piece == Dex.BLANK) {
    // Can't move a blank piece
    return false;
  }

  var color = Dex.getPieceColor(piece);
  if (!opt_skip_turn_check && color != this.whoseTurn()) {
    // Not this player's turn
    return false;
  }
  var dest = this.getPiece(move.to);
  if (dest != Dex.BLANK && color == Dex.getPieceColor(dest)) {
    // Can't move a piece over its own color (this also catches the case
    // where move.to = move.from)
    return false;
  }
  if (move.promote && (piece.toLowerCase() != 'p')) {
    // Trying to promote a piece that is not a pawn
    return false;
  }

  // Now we've done the general validation - do piece-specific validation
  var validator = Dex.VALIDATOR_MAP[piece.toLowerCase()];
  var valid = this[validator](move, color);
  if (!valid) {
    return false;
  }

  // OK, the move is mechanically valid - now see if it leaves us in check.
  // We do this by creating a new board with our same board state, adding the
  // move to it, then calling inCheck() on it.
  if (opt_skip_check_check) {
    // Checking for mechanic validity is enough
    return true;
  } else {
    // Check to see if we are in check now - if so, this is an invalid move
    var copy = this.board.slice();
    var dex = new Dex(copy);
    dex.addParsedMove(move);
    return dex.inCheck(color) == null;
  }
};

/**
 * Processes a move, updating the board state and our array of captured pieces.
 * No validation is done on these moves - it is the caller's responsibility to
 * call validMove() if it requires validation.
 *
 * @param moveStr The move in ICCF format (see file header for more details)
 */
Dex.prototype.addMove = function(team_index, char_index, moveStr) {
  teams = [this.teams.black, this.teams.white];
  var char = teams[team_index].roster[char_index];
  if (moveStr in char) {
    this.moveList[team_index][char_index] = moveStr;
    return true;
  } else {
    return false;
  }
};

// Same as addMove, but takes a parsed move instead of a string
Dex.prototype.addParsedMove = function(move) {
  var capturedPawn = this.isEnPassant(move);
  if (capturedPawn) {
    // Manually capture the pawn for en passant - this is the only case in
    // dex where you capture a piece that isn't on the destination square.
    this.capture(capturedPawn);
  }
  var castle = this.isCastle(move);
  if (castle) {
    // We are castling - move the rook also
    this.movePiece(castle);
  }

  // Move the piece itself
  this.movePiece(move);

  // Save the current move
  this.moveList.push(move);
};

/**
 * Checks to see if this is a castle move, and if so, returns the associated
 * rook move.
 * @param move Move to check (should be a king's move)
 * @return null if not a castle, otherwise object in move format (to/from)
 */
Dex.prototype.isCastle = function(move) {
  var piece = this.getPiece(move.from);
  if (piece == 'k' || piece == 'K') {
    // Moving a king - see if it's a castle move
    if (Math.abs(move.from - move.to) == 2) {
      // We are moving two squares horizontally - it's a castle move.
      // Figure out the associated rook move
      var rook = {};
      if (move.from < move.to) {
        // Moving to the right
        rook.from = move.from + 3;
        rook.to = move.to - 1;
      } else {
        // Moving to the left
        rook.from = move.from - 4;
        rook.to = move.to + 1;
      }
      return rook;
    }
  }
  return null;
};


/**
 * Checks to see if this is an en passant move, and if so, returns the index
 * of the piece to capture.
 *
 * @param move Move to check (should be a pawn move)
 * @return null, or index of piece to capture
 */
Dex.prototype.isEnPassant = function(move) {
  var piece = this.getPiece(move.from);
  if (piece == 'p' || piece == 'P') {
    // Pawn move - could be en-passant
    // See if the pawn is moving diagonally without capturing a piece
    if (Math.abs(move.from - move.to) != 8 &&
        Math.abs(move.from - move.to) != 16) {
      // We've moving diagonally - are we capturing?
      var dest = this.getPiece(move.to);
      if (dest == Dex.BLANK) {
        // Moving diagonally without capturing - calculate which pawn would be
        // captured if this is en passant (the piece in the rank *before* the
        // destination).
        if (move.from > move.to) {
          // Moving down the board
          var capture = move.to + 8;
        } else {
          var capture = move.to - 8;
        }
        return capture;
      }
    }
  }
  return null;
};

/**
 * Given an object with move coordinates (from/to), performs the move on the
 * board.
 *
 * @param move Object with integer 'from', 'to', and optional 'promote'
 *     properties (see parseMove() below)
 */
Dex.prototype.movePiece = function(move) {
  this.capture(move.to);

  if (move.promote) {
    // Doing a pawn promotion - make sure the new piece is the right color
    var promote = move.promote;
    var piece = this.board[move.from];
    if (Dex.getPieceColor(piece) == Dex.BLACK) {
      // Promoting to a black piece, so convert the character to lower case
      promote = promote.toLowerCase();
    }
    this.board[move.to] = promote;
  } else {
    this.board[move.to] = this.board[move.from];
  }
  this.removePiece(move.from);
};

/**
 * Given a piece, figures out the color (i.e. if capital, returns WHITE, else
 * BLACK)
 */
Dex.getPieceColor = function(piece) {
  if (piece >= 'A' && piece <= 'Z') {
    return Dex.WHITE;
  } else if (piece >= 'a' && piece <= 'z') {
    return Dex.BLACK;
  } else {
    throw "Can't get color for piece: " + piece;
  }
};

/**
 * Returns 0 if it's white's turn, or 1 if it's black's turn
 */
Dex.prototype.whoseTurn = function() {
  return(this.moveList.length % 2);
};

/**
 * Moves a piece to the capture list if there is one on the square
 * @param index numeric index into board (0-63)
 */
Dex.prototype.capture = function(index){
  var capturedPiece = this.getPiece(index);
  this.removePiece(index);
  if (capturedPiece != Dex.BLANK) {
    // Add to capture list
    this.captureList.push(capturedPiece);
  }
};


/**
 * Fetches whatever piece is at this index
 * @param index board index from 0-63
 * @return piece value at that position
 */
Dex.prototype.getPiece = function(index) {
  return this.board[index];
};


/**
 * Sets a piece at a given index - mainly exposed for testing purposes.
 * @param index board index from 0-63
 * @param piece piece to set (one of KQBNRPkqbnrp)
 */
Dex.prototype.setPiece = function(index, piece) {
  this.board[index] = piece;
};

/**
 * Just removes a piece from the board (sets it to BLANK)
 */
Dex.prototype.removePiece = function(index) {
  this.board[index] = Dex.BLANK;
};

/**
 * Given an ICCF-format move, returns it in parsed form.
 *
 * @param moveStr in iccf form
 * @return object with these properties:
 *   from: index of from square, from 0 - 63
 *   to: index of to square, from 0-63
 *   promote: piece we are promoting to (Q/R/B/N)
 */
Dex.parseMove = function(moveStr) {
  if (moveStr[0] == '#') {
    // Checkmate - just strip it
    moveStr = moveStr.substring(1);
  }

  // Convert "ff-tt" to a pair of 0-63 numeric indices into the board array
  var result = {};
  result.from = Dex.toIndex(moveStr);
  result.to = Dex.toIndex(moveStr.substring(3));

  if (moveStr.length == 7) {
    // It's a pawn promotion
    var promote = moveStr.charAt(6) - '1';
    var promoteList = "QRBN";
    if (promote >= promoteList.length) {
      throw "Invalid promotion: " + promote;
    }
    result.promote = promoteList.charAt(promote);
  }
  return result;
};

/**
 * Converts a position string (e.g. '11', '88') into an index into the
 * board array (e.g. '11' -> 0, '21' -> 1, '88' -> 63).
 * @param positionStr The position string to convert to an index
 * @return the numeric index (0-63)
 */
Dex.toIndex = function(positionStr) {
  result = positionStr.charAt(0) - '1' + (positionStr.charAt(1)-'1') * 8;
  if (result < 0 || result > 63) {
    throw "Invalid position: " + positionStr;
  }
  return result;
};

/**
 * Fetches the board as an array of pieces
 * @return array of characters representing the board
 */
Dex.prototype.getBoard = function() {
  return this.board;
};

/**
 * Fetches the list of captured pieces
 * @return array of characters representing captured pieces
 */
Dex.prototype.getCaptureList = function() {
  return this.captureList;
};

/***********************************************
 * Individual validation routines, to see if a given piece type can make
 * this move. Basic checks (is the destination square empty or occupied by
 * an enemy, is it the player's turn) have already been done. This routine
 * just needs to check the mechanics of the move - is the piece allowed to
 * move to the passed square given the constraints on piece movement (e.g.
 * bishops must move diagonally) and are the intervening squares unoccupied.
 *
 * @param move Object in move format (to/from integer properties)
 * @return true if move is valid
 */

// Converts move (to/from) to coord pair (to/from)
Dex.toCoords = function(move) {
  var result = {
    from: Dex.toCoord(move.from),
    to: Dex.toCoord(move.to)
  };
  return result;
};

// Converts an index into a pair of x/y coords (0-7)
Dex.toCoord = function(index) {
  var result = {};
  result.x = index % 8;
  result.y = Math.floor(index/8);
  return result;
};

// Given two coords, sees if they are vertical (no change in x)
Dex.isVertical = function(coords) {
  return (coords.to.x == coords.from.x);
};

// Horizontal if no change in y
Dex.isHorizontal = function(coords) {
  return (coords.to.y == coords.from.y);
};

// Diagonal if change in x == change in y
Dex.isDiagonal = function(coords) {
  return (Math.abs(coords.to.y - coords.from.y) == Math.abs(coords.to.x - coords.from.x));
};

Dex.prototype.hasMoved = function(index) {
  for (var i = 0 ; i < this.moveList.length ; i++) {
    if (this.moveList[i].from == index || this.moveList[i].to == index) {
      return true;
    }
  }
  return false;
};

// Tests to see if every square between move.from and move.to is clear
// (not counting the endpoints)
Dex.prototype.isHorizontalClear = function(move) {
  return this.checkClear(move, 1);
};

Dex.prototype.checkClear = function(move, offset) {
  // Moving down/left board, so switch offset to negative
  if (move.from > move.to) {
    offset = 0-offset;
  }
  for (var index = move.from + offset ; index != move.to ; index += offset) {
    if (index > 63 || index < 0) {
      throw "Invalid checkClear: " +
        move.from + " - " + move.to + " - " + offset;
    }
    if (this.getPiece(index) != Dex.BLANK) {
      // Can't move here
      return false;
    }
  }
  return true;
};

// Checks to see if the squares between move.from and move.to are clear
Dex.prototype.isVerticalClear = function(move) {
  return this.checkClear(move, 8);
};

// Checks to see if the squares between move.from and move.to are clear
Dex.prototype.isDiagonalClear = function(move) {
  // Diagonal offsets are one of 7, -7, 9, -9 (that's what we add to move
  // diagonally between rows)
  if (Math.abs(move.from - move.to) % 9 == 0) {
    var offset = 9;
  } else {
    var offset = 7;
  }
  return this.checkClear(move, offset);
};

Dex.prototype.validateKing = function(move, color) {
  // Convert from move to individual X/Y coords
  var coords = Dex.toCoords(move);

  // King can move one square in every direction.
  if (Math.abs(coords.to.x - coords.from.x) <= 1 &&
      Math.abs(coords.to.y - coords.from.y) <= 1) {
    // The king is only moving one square
    return true;
  }

  // The user is trying to move more than one square - see if it's a castle
  var rookMove = this.isCastle(move);
  if (!rookMove) {
    // Nope, not trying to castle, so this is an invalid move
    return false;
  }
  // The king is trying to castle - make sure everything is kosher
  // 1) Make sure the king and the rook have not ever moved
  if (this.hasMoved(move.from) || this.hasMoved(rookMove.from)) {
    // Can't castle, as we've moved one of the pieces.
    return false;
  }
  // Make sure there's nothing between the king and the rook
  if (!this.isHorizontalClear({from: move.from, to: rookMove.from})) {
    return false;
  }
  // OK, everything *looks* clear - now make sure that no pieces are
  // threatening the intervening squares.
  if (this.inCheck(color)) {
    return false;
  }

  // Check the next square over (since abs(move.from + move.to) == 2, the
  // coordinate of the middle square is just move.from + move.to / 2).
  var middleMove = {from: move.from, to: (move.from + move.to)/2 };
  var copy = this.board.slice();
  var dex = new Dex(copy);
  dex.addParsedMove(middleMove);
  if (dex.inCheck(color)) {
    return false;
  }

  // Check the final position of the king - if it's also clear, then this is
  // a valid castle
  copy = this.board.slice();
  dex = new Dex(copy);
  dex.addParsedMove(move);
  if (dex.inCheck(color)) {
    return false;
  }

  // It's a valid castle
  return true;
};

Dex.prototype.validateQueen = function(move) {
  var coords = Dex.toCoords(move);
  if (Dex.isDiagonal(coords)) {
    return this.isDiagonalClear(move);
  } else if (Dex.isHorizontal(coords)) {
    return this.isHorizontalClear(move);
  } else if (Dex.isVertical(coords)) {
    return this.isVerticalClear(move);
  }
  // Piece can't go here
  return false;
};

Dex.prototype.validateRook = function(move) {
  var coords = Dex.toCoords(move);
  if (Dex.isHorizontal(coords)) {
    return this.isHorizontalClear(move);
  } else if (Dex.isVertical(coords)) {
    return this.isVerticalClear(move);
  }
  // Piece can't go here
  return false;
};

Dex.prototype.validateBishop = function(move) {
  // Bishop move is simple - is it diagonal, and clear to the destination
  var coords = Dex.toCoords(move);
  return Dex.isDiagonal(coords) && this.isDiagonalClear(move);
};

Dex.prototype.validateKnight = function(move) {
  var coords = Dex.toCoords(move);
  // Knight moves one vertical and two horizontal, or two horizontal and one
  // vertical.
  if ((Math.abs(coords.to.x - coords.from.x) == 1 &&
       Math.abs(coords.to.y - coords.from.y) == 2) ||
      (Math.abs(coords.to.x - coords.from.x) == 2 &&
       Math.abs(coords.to.y - coords.from.y) == 1)) {
    return true;
  }
  return false;
};

Dex.prototype.validatePawn = function(move, color) {
  var coords = Dex.toCoords(move);
  // Pawns move only in one direction - make sure it's the right one'
  if (color == Dex.WHITE && coords.to.y <= coords.from.y) {
    return false;
  } else if (color == Dex.BLACK && coords.to.y >= coords.from.y) {
    return false;
  }

  if (Dex.isVertical(coords)) {
    // Make sure we're moving an acceptable # square
    var numSquares = Math.abs(coords.from.y - coords.to.y);
    if (numSquares > 2) {
      // Too far
      return false;
    } else if (numSquares == 2 && this.hasMoved(move.from)) {
      // Can't move two squares if you already moved before
      return false;
    }

    // Now just make sure intervening squares are free.
    var index = (color == Dex.WHITE ? 8 : -8);
    var i = move.from;
    while (1) {
      i = i + index;
      if (this.getPiece(i) != Dex.BLANK) {
        // Path isn't empty'
        return false;
      }
      if (i == move.to) {
        break;
      }
    }
    // If we get here, we know the move is valid - go for it!
    return true;
  } else {
    if (!Dex.isDiagonal(coords)) {
      return false;
    }
    if (Math.abs(coords.from.x - coords.to.x) != 1 &&
        Math.abs(coords.from.y - coords.to.y) != 1) {
      return false;
    }

    // OK, we are moving diagonally - this is only acceptable in two situations:
    // There's an enemy on the square, or it's en passant
    if (this.getPiece(move.to) != Dex.BLANK) {
      return true;
    } else {
      // See if it's en passant
      var capturedPawn = this.isEnPassant(move);
      var opposingPawn = (color == Dex.WHITE ? 'p' : 'P');
      if (capturedPawn != null && this.getPiece(capturedPawn) == opposingPawn) {
        // We have a captured pawn - now, has that pawn only moved once, and
        // on the most recent move?
        var lastMove = this.getLastMove();
        if (lastMove) {
          // Make sure this last move involved the pawn on the destination
          // square
          if (lastMove.to == capturedPawn &&
              Math.abs(lastMove.from - lastMove.to) == 16) {
            // It's en passant!
            return true;
          }
        }
      }
      return false;
    }
  }
};

/**
 * Fetches the last move made, or null if there have been no moves
 */
Dex.prototype.getLastMove = function() {
  var lastMove = this.moveList == null ?
    null : this.moveList[this.moveList.length-1];
  return lastMove;
};

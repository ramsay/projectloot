'''Project Dex
Simplistic multiplayer card-like RPG.
'''


import time
import sys
import http

import ajax
import gamemodel
import simplejson
from google.appengine.ext import db
from google.appengine.api import users
from custom_db import JsonProperty

DEBUG = True
import random


class Ability(object):
    '''Base Ability class. Abilities are the one special ability that each hero
    has in addition to Attack and Defend. These general expend MP and add
    interesting effects to the game. During battle the method `Ability.affect`
    will be called on a specific target.'''
    description = "A detailed description of what the ability does"
    cost = 1

    def affect(self, target):
        '''Empty effect method, it's up to the '''
        raise NotImplementedError(repr(self) + repr(target))

    def __repr__(self):
        return self.__class__.__name__ + "(" + str(self.cost) + ")"


class Heal(Ability):
    '''A simple heal ability for testing purposes.'''
    description = "Use primitive medical skills"
    cost = 2

    def affect(self, target):
        '''Raise targets HP by (1,5)'''
        target.h_p += random.randint(1, 5)


class Roar(Ability):
    '''A simple status effect ability for testing.'''
    description = "Strike fear in the hearts of foes"

    def affect(self, target):
        '''Reduce targets defense by 1'''
        target.defense -= 1


class Hero(object):
    '''Base battle piece class'''
    h_p = 1
    m_p = 1
    defense = 1
    strength = 1
    agility = 1
    ability = Ability()

    def __init__(self, name):
        self.name = name

    def attack(self, target):
        '''Use primitive physical force to hurt or maim one's target. If the
        target has defendors, we subtract the target's defense pool from our
        attack. We subtract the remaining damage from our target's HP pool.
        The damage dealt is returned.'''
        dmg = self.strength
        if target.defendors:
            dmg -= target.defense
            target.defendors.pop()
        if dmg > 0.0:
            target.h_p -= dmg
        return dmg

    def defend(self, target):
        '''Add this Hero to the target's defense team. While on defense we
        use the team's pooled defense stat. After each physical attack a
        `random` defendor is removed.'''
        target.defendors.append(self)

    def __repr__(self):
        return self.name + " the " + self.__class__.__name__


class WeakMage(Hero):
    '''A sample mage class hero'''
    agility = 2
    m_p = 2
    ability = Heal()

    def __init__(self, name="Medic!"):
        Hero.__init__(self, name)


class WeakFighter(Hero):
    '''A sample fighting class hero'''
    ability = Roar()

    def __init__(self, name="Brave"):
        Hero.__init__(self, name)


class Team(object):
    '''This is the battle team object, it holds the hp, mp, and defense pools.
    '''
    h_p = 0
    m_p = 0
    defense = 0

    def __init__(self, name, players):
        self.name = name
        self.players = players
        for player in players:
            self.h_p += player.h_p
            self.m_p += player.strength
            self.defense += player.defense
        self.defendors = []

    def reset(self):
        '''Generally called at the end or beginning of each round. Resets
        various states that are in the scope of a round, such as the heroes
        that are defending.'''
        self.defendors = []


def end_game(teams):
    '''Tests all teams for the simple end game scenario where at least one
    team's HP pool is less than 1'''
    for team in teams:
        if team.h_p < 1:
            return True
    return False


def get_user_choice(hero, team, teams):
    '''Gets user input for a specific hero on a team this round'''
    choice = 0
    target = 0
    choices = [1, 2, 3]
    if hero.ability.cost > team.m_p:
        choices.pop()
    while choice not in choices:
        print team.name, "(", team.h_p, ") - ", hero.name
        print "1) Attack"
        print "2) Defend"
        if 3 in choices:
            print "3) ", hero.ability
        choice = input("Action? ")
    if choice == 2:
        hero.defend(team)
    else:
        while target not in range(1, len(teams) + 1):
            target = input("Target (1 red, 2 blu)")
    if choice == 1:
        return (hero.agility, hero.attack, teams[target-1])
    elif choice == 3:
        team.m_p -= hero.ability.cost
        return (hero.agility, hero.ability.affect, teams[target-1])


class Battle(gamemodel.Game):
    '''A game model that provides functions to alter the state.'''
    #max_players = 4
    #min_players = 1 #(waiting) 2(playable)
    teams = JsonProperty()
    moves1 = db.StringListProperty()
    moves2 = db.StringListProperty()
    tasks = db.StringListProperty()

    # Battle stats
    health = db.ListProperty(int)
    magic = db.ListProperty(int)
    defense = db.ListProperty(int)

    def initialize(self):
        '''Using the current teams update the battle stats.'''
        self.players = [self.player1, self.player2]
        health = [0] * len(self.players)
        magic = [0] * len(self.players)
        defense = [0] * len(self.players)
        i = 0
        for team in self.teams:
            for hero in team:
                health[i] += hero.h_p
                magic[i] += hero.m_p
                defense[i] += hero.defense
            i += 1
        self.health = health
        self.magic = magic
        self.defense = defense

    def get_moves(self, i):
        '''' Getter for the flat database fields '''
        i = int(i)
        if i == 1:
            return self.moves1
        elif i == 2:
            return self.moves2
        else:
            raise Exception("Index out of range, only moves[1...2]")

    def submit_moves(self, user, commands):
        '''Add moves to the appropriate move list, if this is the last move set
        needed complete the turn and fillout the tasks.'''
        if user not in self.players:
            raise Exception("Invalid user")
        user_index = self.players.index[user]
        moves = self.get_moves(user_index)
        if len(moves) > len(self.tasks):
            raise Exception("User has already submitted a move set this round")
        bucket = []
        magic = self.magic[user_index]
        hero = iter(self.teams[user])
        for choice, target in commands:
            if 3 < choice < 1 or 1 > target > len(self.players):
                hero.next()
                continue
            if choice == 1:
                bucket.append((hero.agility, 1, target-1))
            elif choice == 2:
                bucket.append((sys.maxint, 2, target - 1))
            elif choice == 3 and magic > hero.ability.cost:
                magic -= hero.ability.cost
                bucket.append((hero.agility, 3, target-1))
            if len(bucket) >= len(self.teams[user_index]):
                break
            hero.next()

        moves.append(json.dumps(bucket))
        return moves[-1]

    def finish_round(self):
        '''All players have submitted their moves now we sort them and update
        the battle stats.
        '''
        moves = [self.get_moves(i)[-1]
            for i in range(1, len(self.players) + 1)]
        pools = [Team(self.health[i], self.magic[i], self.defense[i])
            for i in range(0, len(self.players))]
        tasks = []
        for move, team in zip(moves, self.teams):
            tuples = json.decode(move)
            for hero, tup in zip(team, tuples):
                if tup[1] == 1:
                    call = hero.attack
                elif tup[1] == 3:
                    call = hero.ability
                else:
                    call = hero.defend
                tasks.append((tup[0], call, pools[tup[2]]))
        tasks.sort()
        for task in tasks:
            print sys.log >> task
            task[1].__call__(task[2])
        self.tasks.append(tasks)

    def to_dict(self, user):
        """ Converts a game object to a dict with the following properties for
        ease of json-ification:
        {'creator': "player 1",    // The nickname for player 1
         'opponent': "player 2",   // Omitted if game is open/joinable
         'time_limit': 5,          // Currently only 5 or 10 is supported,
                                   //   or omitted if untimed game
         'player1_time': 1234,     // Time bank in msecs, omitted if untimed
         'player2_time': 5678,     // Time bank in msecs, omitted if untimed
         'is_creator' : true       // True if the player is the game creator
                                   //   (e.g. player == player1)
         'is_invitee': true,       // present if user is the invitee and
                                   //   status=GAME_STATUS_INVITED
         'is_participant': true,   // omitted if user not a participant
         'status': 0/1/2/3         // open, invited, active, complete
         'victor': 0/1/2           // draw, player1, player2
         'can_delete' : true,      // true if 'is_participant' and #
                                   // moves < 2
         'whose_turn' : 0/1        // 0 = white, 1 = black
        }
        """
        result = {}
        result['creator'] = self.player1.nickname()
        result['status'] = self.status
        result['key'] = str(self.key())

        # Set the opponent to the appropriate value. We send nothing down if
        # this is an unclaimed open game
        if self.status >= gamemodel.GAME_STATUS_ACTIVE:
            # Game is active or completed
            result['opponent'] = self.player2.nickname()
        elif self.status == gamemodel.GAME_STATUS_INVITED:
            if self.player2:
                result['opponent'] = self.player2.nickname()
            else:
                result['opponent'] = self.invitee

        # Send down the time limit appropriate to the game type
        if self.game_type == gamemodel.GAME_TYPE_BLITZ_5:
            result['time_limit'] = 5
        elif self.game_type == gamemodel.GAME_TYPE_BLITZ_10:
            result['time_limit'] = 10

        # If the user is a participant, send down information about their
        # permissions and status
        if self.user_is_participant(user):
            result['is_participant'] = True
            self.moves1 = list(self.moves1)
            result['can_delete'] = len(self.moves1) <= 2
            if user == self.player1:
                result['is_creator'] = True
            elif self.status == gamemodel.GAME_STATUS_INVITED:
                result['is_invitee'] = True

        # If this game has a time limit, send down the time status of each
        # player
        if 'time_limit' in result:
            result['player1_time'] = self.player1_time
            result['player2_time'] = self.player2_time

        if self.status == gamemodel.GAME_STATUS_COMPLETE:
            result['victor'] = self.victor
        else:
            result['round'] = len(self.moves1) + 1
        result['type'] = "dex"
        return result

    def user_is_participant(self, user):
        return self.player1 == user or self.player2 == user


def battle(teams):
    '''A simple battle simulation'''
    while not end_game(teams):
        tasks = []
        for team in teams:
            for hero in team.players:
                tasks.append(get_user_choice(hero, team, teams))
        tasks.sort()
        for task in tasks:
            print task[1], task[2]
            task[1].__call__(task[2])
        for team in teams:
            team.reset()
    standings = [(team.h_p, team.name) for team in teams]
    standings.sort()
    standings.reverse()
    return standings


def print_game_end(results):
    '''Prints out a friendly representation of the battle results'''
    print "The game has ended our winner is ", results[0][1]
    print "With a lead of ", results[0][0] - results[1][0], " over ",
    print results[1][1]


class DexHandler(ajax.AjaxHandler):
    ''' Converting dex.battle into a gae request hnadler '''

    def Get(self, user):
        ''' Our handler for HTTP GET requests, copying from GAE demo
        "blitz" '''
        self.response.headers['Content-Type'] = 'text/javascript'
        path_list = self.request.path.strip('/').split('/')

    def Put(self, user):
        ''' Create a game '''
        player1 = users.GetCurrentUser()
        invitee = self.request.get("email")
        status = gamemodel.GAME_STATUS_OPEN
        if invitee:
            status = gamemodel.GAME_STATUS_INVITED
        game_type = self.request.get("game_type")
        public = False
        if (self.request.get("public") and
            self.request.get("public").lower() == "true"):
            public = True
        invitee = self.request.get("email")

        newGame = Battle(
            player1=player1, player1_color = 1, public=public,
            status=status, game_type=game_type)

        if invitee:
            try:
                newGame.player2 = users.User(invitee)
                if newGame.player2 == newGame.player1:
                    self.error(http.HTTP_ERROR)
                    self.response.out.write(
                        "Cannot invite yourself to a game")
                    return
            except usernotfoundError:
                newGame.invitee = invitee

        newGame.put()

    def Post(self, user):
        ''' Update game with move or chat '''
        battle_to_modify = self._get_battle_to_modify(user)
        if battle_to_modify:
            path_list = self.request.path.strip('/').split('/')
            command = path_list[2]
            if command == 'join':
                result = battle_to_modify.join(user)
                if not result:
                    self.error(http.HTTP_FORBIDDEN)
            elif command == 'move':
                #JSON encoded list of decisions.
                moves = self.request.post('moves')
                victor = None
                is_resignation = False
                if moves:
                    victor = get_player_number(battle_to_modify, user, True)
                    is_resignation = True
                elif moves == 'draw':
                    victor = 0
                if not battle_to_modify.update(user, moves, timer, victor):
                    self.error(http.HTTP_FORBIDDEN)
                else:
                    if battle_to_modify.game_type == gamemodel.GAME_TYPE:
                        pass

    def _get_battle_to_modify(self, user):
        battle_id = self._get_id_from_path()
        if battle_id is None:
            # Invalid delete request (malformed path)
            self.error(http.HTTP_ERROR)
            self.response.out.write('Invalid request')
        else:
            battle = Battle.get(battle_id)
            if battle is None:
                self.error(http.HTTP_GONE)
            elif not battle.user_can_modify(user):
                self.error(http.HTTP_FORBIDDEN)
                self.respone.out.write('cannot modify game')
            else:
                return battle
        return None

    def _get_id_from_path(self):
        """ Fetches an ID from the second path element (i.e. expects a URL path
            of the form /game/<id>)
        """
        path_list = self.request.path.strip('/').split('/')
        if len(path_list) < 2:
            return None
        else:
            return path_list[1]

    def error(self, errors):
        print self, errors

def battles_by_user_list(user):
    """ Returns a list of non-completed games that involve this user. Have to
    do two separate queries, since we can't query either player1 OR player2
    """
    battles1 = Battle.gql("WHERE player1 = :user AND status < :status",
        user=user, status=gamemodel.GAME_STATUS_COMPLETE)
    battles2 = Battle.gql("WHERE players = :user AND status < :status",
        user=user, status=gamemodel.GAME_STATUS_COMPLETE)
    result = filter(filter_expired_battles, list(battles1) + list(battles2))
    result.sort(key=lambda obj: obj.last_modified, reverse=True)
    return result


def filter_expired_battles(gameObj):
    """ Checks the date of the game - if it is expired, deletes it and
    returns false.
    """
    elapsed = time.time() - time.mktime(gameObj.last_modified.timetuple())
    # Games with no moves expire after a week
    if ((not gameObj.moves1 or (len(gameObj.moves1) == 0)) and
        (elapsed >= gamemodel.ABANDONED_GAME_DURATION)):
        gameObj.delete()
        return False

    # Untimed games don't expire currently
    if gameObj.game_type == gamemodel.GAME_TYPE_CHESS:
        return True

    # OK, we're a timed game. If we're an open game (nobody has joined yet) we
    # expire after 15 minutes.
    if gameObj.status == gamemodel.GAME_STATUS_OPEN:
        if elapsed > gamemodel.OPEN_GAME_EXPIRATION:
            gameObj.delete()
            return False
        else:
            return True

    # OK, there are moves in this game. Calculate whose turn it is, how long
    # since their last move, and whether the game should be over or not. This is
    # slightly dangerous since games could be prematurely ended if the times on
    # the servers are out of sync, so we give the user a couple of minutes of
    # leeway before terminating it.
    if gameObj.whose_turn() == gameObj.player1_color:
        remaining = gameObj.player1_time
    else:
        remaining = gameObj.player2_time
    if elapsed < (remaining/1000 + gamemodel.TIMED_GAME_BUFFER):
        # Game hasn't expired yet
        return True

    # OK, this game is expiring - if the game only has a few moves, we'll just
    # delete it. Otherwise, we'll force a timeout for the player who abandoned
    # it.
    if gameObj.moves1 and (len(gameObj.moves1)
        > gamemodel.MAX_MOVES_FOR_DELETION):
        turn = gameObj.whose_turn()
        if turn == gameObj.player1_color:
            # player 1 must lose
            loser = gameObj.player1
        else:
            loser = gameObj.player2
        # Set the time as expired for the poor loser
        gameObj.update(loser, timer=0)
    else:
        gameObj.delete()
    return False

def public_battle_list():
    """ Returns a list of open and public active games
    """
    games = Battle.gql("WHERE status = :status"
                   " ORDER BY last_modified DESC LIMIT 25",
                   status=gamemodel.GAME_STATUS_OPEN)

    games2 = Battle.gql("WHERE status = :status AND public=:public"
                    " ORDER BY last_modified DESC LIMIT 25",
                    status=gamemodel.GAME_STATUS_ACTIVE, public=True)
    return filter(filter_expired_battles, list(games) + list(games2))

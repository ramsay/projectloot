'''Project Dex
Simplistic multiplayer card-like RPG.
'''

import os
import random
import re
import time
import urllib
import wsgiref.handlers

import chat

import simplejson
import ajax
import gamemodel
import http

import sys
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


class Battle(db.Model):
    '''A game model that provides functions to alter the state.'''
    player1 = db.UserProperty(required=True)
    #max_players = 4
    #min_players = 1 #(waiting) 2(playable)
    players = db.StringListProperty()
    team1 = JsonProperty()
    team2 = JsonProperty()
    team3 = JsonProperty()
    team4 = JsonProperty()
    moves1 = db.StringListProperty()
    moves2 = db.StringListProperty()
    moves3 = db.StringListProperty()
    moves4 = db.StringListProperty()
    tasks = db.StringListProperty()

    # Battle stats
    health = db.ListProperty(int)
    magic = db.ListProperty(int)
    defense = db.ListProperty(int)

    # Properties of blitz game model

    # If True, anyone can view this game
    public = db.BooleanProperty(default=False)

    # Description of the status of this game. See the GAME_STATUS values
    status = db.IntegerProperty(required=True)

    # The index of the victor (1 = player 1, 2 = player 2, 0 = draw)
    victor = db.IntegerProperty()

    # Various strings are valid: chess, blitz-5, blitz-10
    game_type = db.StringProperty(required=True)

    def initialize(self):
        '''Using the current teams update the battle stats.'''
        health = [0] * len(self.players)
        magic = [0] * len(self.players)
        defense = [0] * len(self.players)
        teams = [self.team1, self.team2, self.team3, self.team4]
        i = 0
        for team in teams[:len(self.players)]:
            for hero in team:
                heath[i] += hero.h_p
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
        elif i == 3:
            return self.moves3
        elif i == 4:
            return self.moves4
        else:
            raise Exception("Index out of range, only moves[1...4]")

    def get_team(self, i):
        '''' Getter for the flat database fields '''
        i = int(i)
        if i == 1:
            return self.team1
        elif i == 2:
            return self.team2
        elif i == 3:
            return self.team3
        elif i == 4:
            return self.team4
        else:
            raise Exception("Index out of range, only team[1...4]")

    def submit_moves(self, user, commands):
        '''Add moves to the appropriate move list, if this is the last move set
        needed complete the turn and fillout the tasks.'''
        if user not in self.players:
            raise Exception("Invalid user")
        moves = self.get_moves(user)
        if len(moves) > len(self.tasks):
            raise Exception("User has already submitted a move set this round")
        bucket = []
        magic = self.magic[self.players.index[user]]
        hero = iter(self.get_team(user))
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
            if len(bucket) >= len(self.get_team(user)):
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
        teams = [self.get_team(i)
            for i in range(1, len(self.players) + 1)]
        pools = [Team(self.health[i], self.magic[i], self.defense[i])
            for i in range(0, len(self.players))]
        tasks = []
        for move, team in zip(moves, teams):
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
            player1=player1, public=public,
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
        game_to_modify = self._get_game_to_modify(user)
        if game_to_modify:
            path_list = self.request.path.strip('/').split('/')
            command = path_list[2]
            if command == 'join':
                result = game_to_modify.join(user)
                if not result:
                    self.error(http.HTTP_FORBIDDEN)
            elif command == 'move':
                #JSON encoded list of decisions.
                moves = self.request.post('moves')
                victor = None
                is_resignation = False
                if moves:
                    victor = get_player_number(game_to_modify, user, True)
                    is_resignation = True
                elif moves == 'draw':
                    victor = 0
                if not game_to_modify.update(user, move, timer, victor):
                    self.error(http.HTTP_FORBIDDEN)
                else:
                    if game_to_modify.game_type == gamemodel.GAME_TYPE:
                        pass

    def _get_game_to_modify(self):
        pass

    def error(self):
        pass
